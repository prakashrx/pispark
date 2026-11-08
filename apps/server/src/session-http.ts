import type { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import {
  type SessionRuntime,
  RuntimeError,
} from "./runtime/session-runtime.js";
import type { Catalog, Command, Receipt, SnapshotEvent } from "./protocol.js";
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

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FRAME = 256 * 1024;
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
    { receipt: Receipt; input: string; expires: number; lifecycle?: string }
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
    if (
      pool.length >= (lifecycle ? 32 : 256) ||
      pool.filter((e) => e.receipt.state === "accepted").length >= 16
    )
      throw new RuntimeError("limit");
    const receipt: Receipt = {
      commandId: command.commandId,
      state: "accepted",
      ...("sessionId" in command ? { sessionId: command.sessionId } : {}),
    };
    const entry = { receipt, input, expires: Infinity, lifecycle };
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
      } else {
        const detail = /^\/api\/sessions\/([\w-]+)\/messages\/(\d{1,9})\/([\w-]+)\/(\d{1,9})\/(\d{1,10})$/.exec(path);
        if (request.method === "GET" && detail && !url.search) {
          const [, id, index, key, part, offset] = detail;
          if (!uuid.test(id!) || !uuid.test(key!)) throw new RuntimeError("invalid-input");
          const page = this.runtime.messagePage(id!, Number(index), key!, Number(part), Number(offset));
          sendJson(response, 200, page);
          return;
        }
        const match = /^\/api\/sessions\/([\w-]+)\/(events|window)$/.exec(path);
        if (request.method !== "GET" || !match || !uuid.test(match[1]!)) {
          sendJson(response, 404, { error: "not-found" });
          return;
        }
        const id = match[1]!;
        if (match[2] === "events" && !url.search) {
          if (this.streams.size >= 16) throw new RuntimeError("limit");
          await this.observe(id, response);
        } else if (
          match[2] === "window" &&
          [...url.searchParams.keys()].every((key) => key === "before")
        ) {
          const raw = url.searchParams.get("before");
          if (raw !== null && !/^\d{1,9}$/.test(raw))
            throw new RuntimeError("invalid-input");
          sendJson(
            response,
            200,
            this.runtime.window(id, raw === null ? undefined : Number(raw)),
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
  private async observe(id: string, response: ServerResponse) {
    let observation;
    try {
      observation = this.runtime.observeWindow(id);
    } catch (error) {
      if (!(error instanceof RuntimeError) || error.code !== "not-found") throw error;
      sendJson(response, 410, { error: "not-found" });
      return;
    }
    this.streams.add(response);
    const close = () => observation.events.close();
    response.once("close", close);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = async (event: SnapshotEvent) => {
      const frame = `event: snapshot\ndata: ${JSON.stringify(event)}\n\n`;
      if (Buffer.byteLength(frame) > MAX_FRAME) throw new RuntimeError("limit");
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
    // Lifetime cap frees abandoned connections even if no further writes occur; clients resnapshot.
    const lifetime = setTimeout(() => response.end(), 60_000);
    try {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      });
      await write({
        type: "snapshot",
        boundary: "initial",
        sessionId: id,
        sequence: observation.snapshot.sequence,
        snapshot: observation.snapshot,
      });
      let sequence = observation.snapshot.sequence;
      for await (const event of observation.events) {
        if (response.destroyed || response.writableEnded) break;
        if (event.sequence <= sequence) continue;
        await new Promise((resolve) => setTimeout(resolve, 100)); // <=10 snapshots/sec, coalesced outside SDK listeners.
        let snapshot;
        try {
          snapshot = this.runtime.window(id);
        } catch {
          break;
        } // stop/unload settlement remains in its receipt; reconnect must open explicitly.
        sequence = snapshot.sequence;
        await write({
          type: "snapshot",
          boundary: "update",
          sessionId: id,
          sequence,
          snapshot,
        });
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
