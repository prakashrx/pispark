import type { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import {
  type SessionRuntime,
  RuntimeError,
} from "./runtime/session-runtime.js";
import type { Catalog, Command, LiveEvent, Receipt } from "./protocol.js";
import type { Json } from "./stream-ops.js";
import type { ProviderHttp } from "./provider-http.js";
import { validChoice } from "./runtime/provider-storage.js";
import {
  correlated,
  requestId,
  silentLogger,
  type SafeLogger,
} from "./logger.js";
import { PersonaHttp } from "./persona-http.js";
import { validPersonaId } from "./personas/format.js";
import { homedir } from "node:os";
import { viewBundle } from "./extensions/view-compiler.js";
import { CallError } from "./extensions/views.js";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FRAME = 256 * 1024;
/** A live frame is a snapshot or one tick's operations; a history page may carry one large item. */
const MAX_LIVE_FRAME = 1024 * 1024;
const ITEMS_FRAME = 1024 * 1024;
const MAX_IMAGE = 20 * 1024 * 1024;
/** How long a batch waits so a burst of Pi events leaves as one frame. */
const FLUSH_MS = 50;
export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  maximum = MAX_FRAME,
) {
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) > maximum) throw new RuntimeError("limit");
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(text);
}
function failure(error: unknown) {
  return error instanceof RuntimeError ? error.code : "execution";
}
function validate(value: unknown): Command {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RuntimeError("invalid-input");
  const c = value as Record<string, unknown>;
  if (
    typeof c.type !== "string" ||
    typeof c.commandId !== "string" ||
    !uuid.test(c.commandId)
  )
    throw new RuntimeError("invalid-input");
  if (c.type === "answer") return validAnswer(c);
  const keys =
    c.type === "create"
      ? [
          "folder",
          ...(c.model === undefined ? [] : ["model"]),
          ...(c.persona === undefined ? [] : ["persona"]),
        ]
      : ["open", "reload", "cancel", "stop"].includes(String(c.type))
        ? ["sessionId"]
        : ["start", "steer", "follow-up"].includes(String(c.type))
          ? ["sessionId", "text"]
          : undefined;
  if (
    !keys ||
    Object.keys(c).length !== keys.length + 2 ||
    Object.keys(c).some((key) => !["commandId", "type", ...keys].includes(key))
  )
    throw new RuntimeError("invalid-input");
  if (c.model !== undefined && !validChoice(c.model))
    throw new RuntimeError("invalid-input");
  if (c.persona !== undefined && !validPersonaId(c.persona))
    throw new RuntimeError("invalid-input");
  for (const key of keys.filter((key) => key !== "model" && key !== "persona"))
    if (typeof c[key] !== "string" || !(c[key] as string).trim())
      throw new RuntimeError("invalid-input");
  if ("sessionId" in c && !uuid.test(String(c.sessionId)))
    throw new RuntimeError("invalid-input");
  if (c.type === "create" && (c.folder as string).length > 4096)
    throw new RuntimeError("invalid-input");
  if ("text" in c && Buffer.byteLength(String(c.text)) > 64 * 1024)
    throw new RuntimeError("invalid-input");
  // SAFETY: discriminant, exact keys and every required field validated above.
  return c as unknown as Command;
}
/** An answer to an extension question: a string, a yes/no, or null to dismiss. */
function validAnswer(c: Record<string, unknown>): Command {
  if (
    Object.keys(c).length !== 5 ||
    !["commandId", "type", "sessionId", "dialogId", "value"].every((key) => key in c) ||
    !uuid.test(String(c.sessionId)) ||
    !uuid.test(String(c.dialogId)) ||
    !(
      c.value === null ||
      typeof c.value === "boolean" ||
      (typeof c.value === "string" && Buffer.byteLength(c.value) <= 64 * 1024)
    )
  )
    throw new RuntimeError("invalid-input");
  // SAFETY: exact keys and every field validated above.
  return c as unknown as Command;
}
/** An extension component's call: which placement, which of its functions, and optional JSON data. */
function validCall(value: unknown): { slot: string; key: string; name: string; data?: Json } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RuntimeError("invalid-input");
  const c = value as Record<string, unknown>;
  const keys = ["slot", "key", "name", ...("data" in c ? ["data"] : [])];
  const short = (value: unknown, empty = false) =>
    typeof value === "string" && (empty ? /^[\w.:-]{0,64}$/ : /^[\w.:-]{1,80}$/).test(value);
  if (
    Object.keys(c).length !== keys.length ||
    !keys.every((key) => key in c) ||
    !short(c.slot) ||
    !short(c.key, true) ||
    !short(c.name)
  )
    throw new RuntimeError("invalid-input");
  // SAFETY: exact keys and every field validated above; the body limit bounds `data`.
  return c as { slot: string; key: string; name: string; data?: Json };
}
export async function body(
  request: IncomingMessage,
  maximum = 72 * 1024,
): Promise<unknown> {
  if (
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
      request.headers["content-type"] ?? "",
    ) ||
    request.headers["content-encoding"]
  )
    throw new RuntimeError("invalid-input");
  let size = 0;
  const chunks: Buffer[] = [];
  const timer = setTimeout(() => request.destroy(), 5000);
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maximum) throw new RuntimeError("limit");
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new RuntimeError("invalid-input");
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Same-origin, local-only commands and bounded snapshot synchronization. */
export class SessionHttp {
  private receipts = new Map<
    string,
    { receipt: Receipt; input: string; expires: number; lifecycle?: string; start?: boolean }
  >();
  private streams = new Set<ServerResponse>();
  private requests = 0;
  private closed = false;
  private readonly personas: PersonaHttp;
  constructor(
    readonly runtime: SessionRuntime,
    private readonly developmentOrigin?: string,
    private readonly providers?: ProviderHttp,
    private readonly logger: SafeLogger = silentLogger,
  ) {
    this.personas = new PersonaHttp(runtime.personas);
  }
  private secure(request: IncomingMessage) {
    const local = request.socket.localAddress;
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(local ?? ""))
      return false;
    const port = request.socket.localPort;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    const host = request.headers.host;
    if (!host || !hosts.includes(host)) return false;
    const origin = request.headers.origin;
    if (
      origin &&
      origin !== `http://${host}` &&
      origin !== this.developmentOrigin
    )
      return false;
    if (request.headers["sec-fetch-site"] === "cross-site") return false;
    // Non-browser clients may omit Origin. Browser mutations must carry it.
    if (
      request.method === "POST" &&
      request.headers["sec-fetch-site"] &&
      !origin
    )
      return false;
    return true;
  }
  private prune() {
    for (const [id, entry] of this.receipts)
      if (entry.receipt.state === "settled" && entry.expires < Date.now())
        this.receipts.delete(id);
  }
  private command(command: Command): Receipt {
    this.prune();
    const input = JSON.stringify(command);
    const existing = this.receipts.get(command.commandId);
    if (existing) {
      if (existing.input !== input) throw new RuntimeError("invalid-input");
      return existing.receipt;
    }
    const lifecycle =
      command.type === "cancel" || command.type === "stop"
        ? `${command.sessionId}:${command.type}`
        : undefined;
    if (lifecycle) {
      const duplicate = [...this.receipts.values()].find(
        (e) => e.lifecycle === lifecycle && e.receipt.state === "accepted",
      );
      // Return the canonical retained receipt, not an unbounded alias per retry.
      if (duplicate) return { ...duplicate.receipt };
    }
    const pool = [...this.receipts.values()].filter(
      (e) => Boolean(e.lifecycle) === Boolean(lifecycle),
    );
    // A start stays pending while its prompt waits for a turn and runs; there is at most one per chat.
    if (
      pool.length >= (lifecycle ? 32 : 256) ||
      (command.type !== "start" && pool.filter((e) => e.receipt.state === "accepted" && !e.start).length >= 16)
    )
      throw new RuntimeError("limit");
    const receipt: Receipt = {
      commandId: command.commandId,
      state: "accepted",
      ...("sessionId" in command ? { sessionId: command.sessionId } : {}),
    };
    const entry: { receipt: Receipt; input: string; expires: number; lifecycle?: string; start?: boolean } = {
      receipt,
      input,
      expires: Infinity,
      lifecycle,
      ...(command.type === "start" ? { start: true } : {}),
    };
    this.receipts.set(command.commandId, entry);
    const execute = async () => {
      switch (command.type) {
        case "create":
          receipt.sessionId = (
            await this.runtime.create({
              folder: command.folder,
              ...(command.model ? { model: command.model } : {}),
              ...(command.persona ? { persona: command.persona } : {}),
            })
          ).id;
          break;
        case "open":
          await this.runtime.open(command.sessionId);
          break;
        case "reload":
          await this.runtime.reload(command.sessionId);
          break;
        case "start": {
          // A chat is loaded when it is used; nobody opens or stops chats by hand.
          await this.runtime.ensure(command.sessionId);
          let run;
          try {
            run = this.runtime.start(command.sessionId, command.text);
          } catch (error) {
            // Admission is synchronous. Return a definite rejection before clients clear drafts.
            receipt.state = "settled";
            receipt.outcome = "failed";
            receipt.error = failure(error);
            break;
          }
          Object.assign(receipt, await run.completion);
          break;
        }
        case "steer":
        case "follow-up":
          receipt.outcome = await this.runtime.queue(
            command.sessionId,
            command.text,
            command.type,
          );
          break;
        case "cancel":
          await this.runtime.cancel(command.sessionId);
          break;
        case "stop":
          await this.runtime.stop(command.sessionId);
          break;
        case "answer":
          this.runtime.answer(command.sessionId, command.dialogId, command.value);
          break;
      }
      receipt.outcome ??= "completed";
    };
    void correlated({ operationId: requestId() }, execute)
      .catch((error) => {
        receipt.outcome = "failed";
        receipt.error = failure(error);
      })
      .finally(() => {
        receipt.state = "settled";
        entry.expires = Date.now() + 10 * 60_000;
      });
    return { ...receipt };
  }
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    return correlated({ requestId: requestId() }, () =>
      this.handleRequest(request, response),
    );
  }
  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!this.secure(request)) {
      this.logger.event("http.reject", {
        outcome: "rejected",
        code: "forbidden",
      });
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (this.closed || this.requests >= 32) {
      sendJson(response, 503, { error: "limit" });
      return;
    }
    this.requests++;
    try {
      const url = new URL(request.url!, "http://localhost");
      const path = url.pathname;
      if (path === "/api/personas" || path.startsWith("/api/personas/")) {
        await this.personas.handle(request, response);
        return;
      }
      if (path.startsWith("/api/providers") && this.providers) {
        await this.providers.handle(request, response);
        return;
      }
      if (path === "/api/settings" && !url.search && (request.method === "GET" || request.method === "POST")) {
        sendJson(response, 200, request.method === "GET" ? this.runtime.settings() : this.runtime.updateSettings(await body(request)));
        return;
      }
      if (
        request.method === "POST" &&
        path === "/api/commands" &&
        !url.search
      ) {
        const command = validate(await body(request));
        sendJson(response, 202, this.command(command));
      } else if (
        request.method === "GET" &&
        path === "/api/catalog" &&
        !url.search
      )
        sendJson(response, 200, {
          home: homedir(),
          recentFolders: this.runtime.recentFolders(),
        } satisfies Catalog);
      else if (
        request.method === "GET" &&
        path === "/api/sessions" &&
        !url.search
      ) {
        const sessions = this.runtime
          .list()
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        sendJson(response, 200, {
          sessions: sessions.slice(-256),
          truncated: sessions.length > 256,
          unreadable: this.runtime.unreadableSessions,
        });
      } else if (
        request.method === "GET" &&
        /^\/api\/receipts\/[\w-]+$/.test(path) &&
        !url.search
      ) {
        this.prune();
        const receipt = this.receipts.get(path.split("/").at(-1)!)?.receipt;
        sendJson(
          response,
          receipt ? 200 : 404,
          receipt ?? { error: "unknown-receipt" },
        );
      } else if (request.method === "GET" && /^\/api\/views\/[a-f0-9]{32}\.js$/.test(path) && !url.search) {
        // An extension component, compiled and addressed by its content.
        const code = viewBundle(path.slice("/api/views/".length, -".js".length));
        if (!code) {
          sendJson(response, 404, { error: "not-found" });
          return;
        }
        response.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
          "Content-Length": Buffer.byteLength(code),
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(code);
      } else {
        const calls = /^\/api\/sessions\/([\w-]+)\/calls$/.exec(path);
        if (request.method === "POST" && calls && uuid.test(calls[1]!) && !url.search) {
          await this.call(calls[1]!, validCall(await body(request)), response);
          return;
        }
        const one = /^\/api\/sessions\/([\w-]+)$/.exec(path);
        if (request.method === "GET" && one && uuid.test(one[1]!) && !url.search) {
          sendJson(response, 200, this.runtime.session(one[1]!));
          return;
        }
        const match = /^\/api\/sessions\/([\w-]+)\/(live|items)(?:\/([\w-]{1,64})\/parts\/(\d{1,3}))?$/.exec(path);
        if (request.method !== "GET" || !match || !uuid.test(match[1]!)) {
          sendJson(response, 404, { error: "not-found" });
          return;
        }
        const [, id, kind, itemId, part] = match;
        if (kind === "live" && !url.search && !itemId) {
          if (this.streams.size >= 16) throw new RuntimeError("limit");
          await this.observe(id!, response);
        } else if (kind === "items" && itemId) {
          await this.part(id!, itemId, Number(part), url.searchParams, response);
        } else if (kind === "items" && !itemId) {
          const query = url.searchParams;
          const { before, after, limit } = Object.fromEntries(query);
          const token = /^[\w-]{1,64}$/;
          if (
            [...query.keys()].some((key) => !["before", "after", "limit"].includes(key)) ||
            (before !== undefined && (!token.test(before) || after !== undefined)) ||
            (after !== undefined && !token.test(after)) ||
            (limit !== undefined && !/^\d{1,3}$/.test(limit))
          )
            throw new RuntimeError("invalid-input");
          sendJson(
            response,
            200,
            this.runtime.items(id!, { before, after, limit: limit === undefined ? undefined : Number(limit) }),
            ITEMS_FRAME,
          );
        } else sendJson(response, 400, { error: "invalid-input" });
      }
    } catch (error) {
      this.logger.event(
        "http.failure",
        { outcome: "failed", code: failure(error) },
        "error",
      );
      if (response.headersSent) response.destroy();
      else sendJson(response, 400, { error: failure(error) });
    } finally {
      this.requests--;
    }
  }
  /**
   * An extension component's `host.call(name, data)`: a plain request and response. The result, or
   * the extension's own error message; nothing is retained once it answers.
   */
  private async call(id: string, call: { slot: string; key: string; name: string; data?: Json }, response: ServerResponse) {
    try {
      const result = await this.runtime.call(id, call.slot, call.key, call.name, call.data);
      sendJson(response, 200, result === undefined ? {} : { result });
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      // The extension's own error is an answer like a result: the component shows it.
      if (error instanceof CallError) sendJson(response, 200, { error: failure(error), detail: error.detail });
      else sendJson(response, error instanceof RuntimeError && error.code === "not-found" ? 404 : 400, { error: failure(error) });
    }
  }
  /** An image part's bytes, or a chunk of a clipped text part (`?offset=`). */
  private async part(id: string, itemId: string, part: number, query: URLSearchParams, response: ServerResponse) {
    const offset = query.get("offset");
    if ([...query.keys()].some((key) => key !== "offset") || (offset !== null && !/^\d{1,9}$/.test(offset)))
      throw new RuntimeError("invalid-input");
    if (offset === null) {
      const { mimeType, data } = this.runtime.image(id, itemId, part);
      if (data.length > MAX_IMAGE) throw new RuntimeError("limit");
      response.writeHead(200, {
        "Content-Type": mimeType,
        "Content-Length": data.length,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        // An SVG is only ever drawn as an image; nothing in it may run or load.
        "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      });
      response.end(data);
      return;
    }
    sendJson(response, 200, this.runtime.text(id, itemId, part, Number(offset)));
  }
  private async observe(id: string, response: ServerResponse) {
    let observation;
    try {
      observation = this.runtime.observeLive(id);
    } catch (error) {
      if (!(error instanceof RuntimeError) || error.code !== "not-found") throw error;
      // Not an error: chats unload when idle. The client opens it again and reconnects.
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      response.end(`event: unloaded
data: ${JSON.stringify({ type: "unloaded", sessionId: id } satisfies LiveEvent)}

`);
      return;
    }
    this.streams.add(response);
    const close = () => observation.events.close();
    response.once("close", close);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = async (event: LiveEvent) => {
      const frame = `event: ${event.type}
data: ${JSON.stringify(event)}

`;
      if (Buffer.byteLength(frame) > MAX_LIVE_FRAME) throw new RuntimeError("limit");
      if (!response.write(frame)) {
        const controller = new AbortController();
        timer = setTimeout(() => {
          controller.abort();
          response.destroy();
        }, 2000);
        try {
          await once(response, "drain", { signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      }
    };
    // Lifetime cap frees abandoned connections even if no further writes occur; a client reconnects,
    // gets a fresh snapshot of the live document and fetches only the history it is missing.
    const lifetime = setTimeout(() => response.end(), 60_000);
    try {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      });
      await write(observation.view.snapshot());
      for await (const _ of observation.events) {
        if (response.destroyed || response.writableEnded) break;
        // Pi emits many small events; wait briefly so a burst leaves as one batch.
        await new Promise((resolve) => setTimeout(resolve, FLUSH_MS));
        let batch;
        try {
          batch = observation.view.next();
        } catch {
          break;
        } // stop/unload settlement remains in its receipt; reconnect must open explicitly.
        if (batch) await write(batch);
      }
      response.end();
    } finally {
      clearTimeout(timer);
      clearTimeout(lifetime);
      close();
      this.streams.delete(response);
      response.off("close", close);
    }
  }
  async shutdown() {
    this.closed = true;
    for (const stream of this.streams) stream.end();
    // Both owners begin cleanup even if the other throws or never settles.
    const results = await Promise.allSettled([
      Promise.resolve().then(() => this.providers?.shutdown()),
      Promise.resolve().then(() => this.runtime.shutdown()),
    ]);
    const failure = results.find((r) => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}
