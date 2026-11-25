import { Notifications } from "./notifications.js";
import { validEndpoint } from "./push.js";
import { validEvents, type NotificationState } from "../contract/notification-protocol.js";
import { WorkspaceLive } from "./workspace-live.js";
import { sessionTitle } from "../contract/session-title.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import {
  type SessionRuntime,
  RuntimeError,
} from "../core/runtime/session-runtime.js";
import type { Catalog, Command, LiveEvent, Receipt, WorkspaceArea, WorkspaceChange } from "../contract/protocol.js";
import type { Json } from "../contract/stream-ops.js";
import type { ScheduleInput } from "../contract/schedule-protocol.js";
import type { ProviderHttp } from "./provider-http.js";
import { HostHttp } from "./host-http.js";
import { HostLink } from "../core/host-link.js";
import { validChoice } from "../core/runtime/provider-storage.js";
import {
  correlated,
  requestId,
  silentLogger,
  type SafeLogger,
} from "../core/logger.js";
import { AgentHttp } from "./agent-http.js";
import { validAgentId } from "../core/agents/format.js";
import { homedir } from "node:os";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_MESSAGE, validAttachmentName } from "../core/runtime/attachments.js";
import { pipeline } from "node:stream/promises";
import { ASSET_TYPES, viewAsset, viewBundle } from "../core/extensions/view-compiler.js";
import { CallError } from "../core/extensions/views.js";
import type { RemoteAccess } from "../core/remote/remote-access.js";
import { RemoteHttp, type Admission } from "./remote-http.js";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FRAME = 256 * 1024;
/** A live frame is a snapshot or one tick's operations; a history page may carry one large item. */
const MAX_LIVE_FRAME = 1024 * 1024;
const ITEMS_FRAME = 1024 * 1024;
const MAX_IMAGE = 20 * 1024 * 1024;
/** The largest file an extension component may read through `host.file`. */
const MAX_FILE = 64 * 1024 * 1024;
/** What a file an extension component reads is served as; anything else is plain bytes. */
const FILE_TYPES: Readonly<Record<string, string>> = {
  ...ASSET_TYPES,
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};
/** Files reach the page as data: nothing in them may run or load, whatever they contain. */
const INERT = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
};
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
          ...(c.folder === undefined ? [] : ["folder"]),
          ...(c.model === undefined ? [] : ["model"]),
          ...(c.agent === undefined ? [] : ["agent"]),
        ]
      : c.type === "reload"
        ? ["sessionId", ...(c.model === undefined ? [] : ["model"])]
      : ["open", "cancel", "stop", "archive", "restore", "delete", "compact", "allow-hold", "deny-hold", "release-hold"].includes(String(c.type))
        ? ["sessionId"]
      : c.type === "fork"
        ? ["sessionId", ...(c.entryId === undefined ? [] : ["entryId"])]
      : c.type === "branch"
        ? ["sessionId", "entryId"]
      : c.type === "edit"
        ? ["sessionId", "entryId", "text", ...(c.attachments === undefined ? [] : ["attachments"])]
        : c.type === "rename"
          ? ["sessionId", "title"]
        : c.type === "seen"
          ? ["sessionId"]
        : c.type === "configure"
          ? ["sessionId", ...(c.model === undefined ? [] : ["model"]), ...(c.thinking === undefined ? [] : ["thinking"])]
        : ["start", "steer", "follow-up"].includes(String(c.type))
          ? ["sessionId", "text", ...(c.attachments === undefined ? [] : ["attachments"])]
          : undefined;
  if (
    !keys ||
    Object.keys(c).length !== keys.length + 2 ||
    Object.keys(c).some((key) => !["commandId", "type", ...keys].includes(key))
  )
    throw new RuntimeError("invalid-input");
  if (c.model !== undefined && !validChoice(c.model))
    throw new RuntimeError("invalid-input");
  if (c.agent !== undefined && !validAgentId(c.agent))
    throw new RuntimeError("invalid-input");
  if (
    c.attachments !== undefined &&
    (!Array.isArray(c.attachments) ||
      c.attachments.length > ATTACHMENTS_PER_MESSAGE ||
      !c.attachments.every(validAttachmentName) ||
      new Set(c.attachments).size !== c.attachments.length)
  )
    throw new RuntimeError("invalid-input");
  if (c.type === "configure" && keys.length === 1) throw new RuntimeError("invalid-input");
  for (const key of keys.filter((key) => key !== "model" && key !== "agent" && key !== "attachments"))
    if (typeof c[key] !== "string" || !(c[key] as string).trim())
      throw new RuntimeError("invalid-input");
  if ("sessionId" in c && !uuid.test(String(c.sessionId)))
    throw new RuntimeError("invalid-input");
  if (c.type === "create" && typeof c.folder === "string" && c.folder.length > 4096)
    throw new RuntimeError("invalid-input");
  if (c.type === "rename" && (String(c.title).length > 4096 || !sessionTitle(String(c.title))))
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
function validCall(value: unknown): { point: string; key: string; name: string; data?: Json } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RuntimeError("invalid-input");
  const c = value as Record<string, unknown>;
  const keys = ["point", "key", "name", ...("data" in c ? ["data"] : [])];
  const short = (value: unknown, empty = false) =>
    typeof value === "string" && (empty ? /^[\w.:-]{0,64}$/ : /^[\w.:-]{1,80}$/).test(value);
  if (
    Object.keys(c).length !== keys.length ||
    !keys.every((key) => key in c) ||
    !short(c.point) ||
    !short(c.key, true) ||
    !short(c.name)
  )
    throw new RuntimeError("invalid-input");
  // SAFETY: exact keys and every field validated above; the body limit bounds `data`.
  return c as { point: string; key: string; name: string; data?: Json };
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
  /** Open live streams, and the paired device each one is for (none: this computer). */
  private streams = new Map<ServerResponse, string | undefined>();
  private requests = 0;
  private closed = false;
  private readonly agents: AgentHttp;
  private readonly host: HostHttp;
  private readonly remote?: RemoteHttp;
  constructor(
    readonly runtime: SessionRuntime,
    private readonly developmentOrigin?: string,
    private readonly providers?: ProviderHttp,
    private readonly logger: SafeLogger = silentLogger,
    host?: HostHttp,
    remote?: RemoteAccess,
  ) {
    // Every server answers /api/host; one the launcher did not start is simply not managed.
    this.host = host ?? new HostHttp(new HostLink(() => runtime.runningWork(), () => {}), runtime.dataFolder, () => runtime.runningWork());
    this.agents = new AgentHttp(runtime.agents, (target) => runtime.discoverTools(target));
    this.remote = remote && new RemoteHttp(remote, (device) => this.endRemote(device));
    this.workspace = new WorkspaceLive({
      sessions: () => [this.runtime.list(), this.runtime.archived().length, this.runtime.unreadableSessions],
      schedules: () => this.runtime.listSchedules(),
      routines: () => this.runtime.listRoutines(),
      processes: () => this.runtime.runningProcesses(),
      host: () => this.host.changes(),
    });
    this.untouch = runtime.onTouched(() => this.workspace.poke());
    this.notifications = new Notifications(join(runtime.dataFolder, "notifications"), () => this.runtime.list());
    this.watchForNotifications();
  }
  private readonly notifications: Notifications;
  private stopNotifying?: () => void;
  /** The session list is watched for notifications only while some device is subscribed. */
  private watchForNotifications() {
    if (this.notifications.active && !this.stopNotifying) {
      this.notifications.sessionsChanged();
      this.stopNotifying = this.workspace.listen((areas) => {
        if (areas.includes("sessions")) this.notifications.sessionsChanged();
      });
    } else if (!this.notifications.active && this.stopNotifying) {
      this.stopNotifying();
      this.stopNotifying = undefined;
    }
  }
  /** `/api/notifications/*`: this device's notifications (design set 9). All POST, with the device's push endpoint. */
  private async notify(path: string, request: IncomingMessage, response: ServerResponse, device: string) {
    const input = (await body(request, 8192)) as Record<string, unknown>;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new RuntimeError("invalid-input");
    const endpoint = input.endpoint === undefined ? undefined : validEndpoint(input.endpoint) ? input.endpoint : null;
    if (endpoint === null) throw new RuntimeError("invalid-input");
    switch (path) {
      case "/api/notifications/state":
        return sendJson(response, 200, { publicKey: this.notifications.keys.publicKey, ...this.notifications.state(endpoint) } satisfies NotificationState);
      case "/api/notifications/subscribe":
        if (!endpoint || !validEvents(input.events)) throw new RuntimeError("invalid-input");
        this.notifications.subscribe(device, endpoint, input.events);
        this.watchForNotifications();
        return sendJson(response, 200, {});
      case "/api/notifications/unsubscribe":
        if (!endpoint) throw new RuntimeError("invalid-input");
        this.notifications.unsubscribe(endpoint);
        this.watchForNotifications();
        return sendJson(response, 200, {});
      case "/api/notifications/test":
        if (!endpoint) throw new RuntimeError("invalid-input");
        return sendJson(response, 200, { sent: await this.notifications.test(endpoint) });
      case "/api/notifications/pending":
        if (!endpoint) throw new RuntimeError("invalid-input");
        return sendJson(response, 200, { notifications: this.notifications.take(endpoint) });
      case "/api/notifications/presence":
        if (typeof input.page !== "string" || !/^[\w-]{1,64}$/.test(input.page) || typeof input.visible !== "boolean") throw new RuntimeError("invalid-input");
        this.notifications.present(device, input.page, input.visible);
        return sendJson(response, 200, {});
    }
    sendJson(response, 404, { error: "not-found" });
  }
  private readonly workspace: WorkspaceLive;
  private readonly untouch: () => void;
  private workspaceStreams = 0;
  /**
   * Only requests on a loopback socket, for this server's loopback Host, or for the remote address
   * while remote access is on (Tailscale Serve proxies it to loopback). Same-origin only.
   */
  private admit(request: IncomingMessage): Admission | undefined {
    const socket = request.socket.localAddress;
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(socket ?? ""))
      return;
    const port = request.socket.localPort;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    const host = request.headers.host;
    const local = !!host && hosts.includes(host);
    if (!host || (!local && host !== this.remote?.host)) return;
    // Proxies (Tailscale Serve among them) mark what they forward. A forwarded request is never this
    // computer, even if a proxy rewrote its Host to a loopback one.
    if (local && (request.headers["x-forwarded-for"] || request.headers["tailscale-user-login"])) return;
    const origin = request.headers.origin;
    if (
      origin &&
      origin !== (local ? `http://${host}` : `https://${host}`) &&
      !(local && origin === this.developmentOrigin)
    )
      return;
    if (request.headers["sec-fetch-site"] === "cross-site") return;
    // Non-browser clients may omit Origin. Browser mutations must carry it.
    if (
      request.method === "POST" &&
      request.headers["sec-fetch-site"] &&
      !origin
    )
      return;
    if (local) return { local: true };
    const device = this.remote!.device(request);
    return { local: false, ...(device ? { device } : {}) };
  }
  /** Ends the live streams of one paired device, or of every remote device. */
  private endRemote(device?: string) {
    for (const [stream, owner] of this.streams) if (owner && (device === undefined || owner === device)) stream.end();
    // A removed device is told nothing more.
    if (device !== undefined) {
      this.notifications.forgetDevice(device);
      this.watchForNotifications();
    }
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
    // A start stays pending while its prompt waits for a turn and runs; there is at most one per session.
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
              ...(command.folder === undefined ? {} : { folder: command.folder }),
              ...(command.model ? { model: command.model } : {}),
              ...(command.agent ? { agent: command.agent } : {}),
            })
          ).id;
          break;
        case "open":
          await this.runtime.open(command.sessionId);
          break;
        case "reload":
          if ((await this.runtime.reload(command.sessionId, command.model)).pending?.reload) receipt.outcome = "queued";
          break;
        case "start": {
          // A session is loaded when it is used; nobody opens or stops sessions by hand.
          await this.runtime.ensure(command.sessionId);
          let run;
          try {
            run = this.runtime.start(command.sessionId, command.text, command.attachments);
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
            command.attachments,
          );
          break;
        case "compact":
          await this.runtime.compact(command.sessionId);
          break;
        case "fork":
          receipt.sessionId = await this.runtime.fork(command.sessionId, command.entryId);
          break;
        case "branch":
          await this.runtime.branch(command.sessionId, command.entryId);
          break;
        case "edit": {
          let run;
          try {
            run = await this.runtime.edit(command.sessionId, command.entryId, command.text, command.attachments);
          } catch (error) {
            // A definite rejection before clients clear drafts, as for start.
            receipt.state = "settled";
            receipt.outcome = "failed";
            receipt.error = failure(error);
            break;
          }
          Object.assign(receipt, await run.completion);
          break;
        }
        case "cancel":
          await this.runtime.cancel(command.sessionId);
          break;
        case "stop":
          await this.runtime.stop(command.sessionId);
          break;
        case "archive":
          await this.runtime.archive(command.sessionId);
          break;
        case "rename":
          this.runtime.rename(command.sessionId, command.title);
          break;
        case "seen":
          this.runtime.seen(command.sessionId);
          break;
        case "configure": {
          const doc = await this.runtime.configure(command.sessionId, {
            ...(command.model ? { model: command.model } : {}),
            ...(command.thinking ? { thinking: command.thinking } : {}),
          });
          if (doc.pending?.model || doc.pending?.thinking) receipt.outcome = "queued";
          break;
        }
        case "restore":
          this.runtime.restore(command.sessionId);
          break;
        case "delete":
          this.runtime.delete(command.sessionId);
          break;
        case "allow-hold":
        case "deny-hold":
          this.runtime.answerHold(command.sessionId, command.type === "allow-hold");
          break;
        case "release-hold":
          this.runtime.releaseHold(command.sessionId);
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
    const who = this.admit(request);
    if (!who) {
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
      const remotePath = path === "/api/remote" || path.startsWith("/api/remote/");
      // A device at the remote address that hasn't paired may only ask what it is, and pair.
      if (!who.local && !who.device && !(remotePath && ["/api/remote/me", "/api/remote/pair"].includes(path))) {
        sendJson(response, 401, { error: "unpaired" });
        return;
      }
      if (remotePath && this.remote && !url.search) {
        await this.remote.handle(request, response, path, who);
        return;
      }
      if (path === "/api/agents" || path.startsWith("/api/agents/")) {
        await this.agents.handle(request, response);
        return;
      }
      if (path.startsWith("/api/notifications/") && !url.search && request.method === "POST") {
        await this.notify(path, request, response, who.local ? "local" : who.device!.id);
        return;
      }
      if (path === "/api/live" && !url.search && request.method === "GET") {
        await this.watchWorkspace(response, who.local ? undefined : who.device?.id);
        return;
      }
      if (path === "/api/host" && !url.search) {
        await this.host.handle(request, response);
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
      // Schedules: every one (`GET`), add one (`POST`), change, run now or remove one (`POST`).
      if (path === "/api/schedules" && !url.search && (request.method === "GET" || request.method === "POST")) {
        if (request.method === "GET") sendJson(response, 200, this.runtime.listSchedules(), 1024 * 1024);
        else sendJson(response, 201, this.runtime.addSchedule((await body(request)) as ScheduleInput));
        return;
      }
      const schedule = /^\/api\/schedules\/([\w-]+)(?:\/(run|remove))?$/.exec(path);
      if (schedule && request.method === "POST" && uuid.test(schedule[1]!) && !url.search) {
        const [, id, action] = schedule;
        if (action === "run") {
          await this.runtime.runSchedule(id!);
          sendJson(response, 202, {});
        } else if (action === "remove") {
          this.runtime.removeSchedule(id!);
          sendJson(response, 200, {});
        } else sendJson(response, 200, this.runtime.updateSchedule(id!, (await body(request)) as ScheduleInput));
        return;
      }
      // Processes: every one still running; a session's; one's output after a point; stop one.
      if (path === "/api/processes" && !url.search && request.method === "GET") {
        sendJson(response, 200, this.runtime.runningProcesses(), 1024 * 1024);
        return;
      }
      const processes = /^\/api\/sessions\/([\w-]+)\/processes(?:\/([\w-]+)\/(output|stop))?$/.exec(path);
      if (processes && uuid.test(processes[1]!)) {
        const [, sessionId, id, action] = processes;
        if (!action && request.method === "GET" && !url.search) {
          sendJson(response, 200, { processes: this.runtime.listProcesses(sessionId!) });
          return;
        }
        if (action === "output" && request.method === "GET") {
          sendJson(response, 200, this.runtime.processOutput(sessionId!, id!, Number(url.searchParams.get("since") ?? "0")), 1024 * 1024);
          return;
        }
        if (action === "stop" && request.method === "POST" && !url.search) {
          this.runtime.stopProcess(sessionId!, id!);
          sendJson(response, 202, {});
          return;
        }
      }
      // Routines agents offer: every one (`GET`), switch one on or off (`POST {on}`), run one now.
      if (path === "/api/routines" && !url.search && request.method === "GET") {
        sendJson(response, 200, this.runtime.listRoutines(), 1024 * 1024);
        return;
      }
      const routine = /^\/api\/routines\/([a-z0-9-]+)\/([A-Za-z0-9._-]+)(?:\/(run))?$/.exec(path);
      if (routine && request.method === "POST" && !url.search) {
        const [, agent, id, action] = routine;
        if (action === "run") {
          await this.runtime.runRoutine(agent!, id!);
          sendJson(response, 202, {});
        } else sendJson(response, 200, this.runtime.setRoutine(agent!, id!, ((await body(request)) as { on?: unknown } | undefined)?.on));
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
        (!url.search || url.search === "?archived")
      ) {
        // The sessions in use, or (`?archived`) the ones put away; the newest 256 either way.
        const archived = this.runtime.archived();
        const sessions = (url.search ? archived : this.runtime.list()).sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        );
        sendJson(response, 200, {
          sessions: sessions.slice(-256),
          truncated: sessions.length > 256,
          unreadable: this.runtime.unreadableSessions,
          archived: archived.length,
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
      } else if (request.method === "GET" && /^\/api\/views\/assets\/[a-f0-9]{32}\.[a-z0-9]{2,5}$/.test(path) && !url.search) {
        // A static file an extension component imported, addressed by its content.
        const asset = await viewAsset(path.slice("/api/views/assets/".length));
        if (!asset) {
          sendJson(response, 404, { error: "not-found" });
          return;
        }
        response.writeHead(200, {
          "Content-Type": asset.type,
          "Content-Length": asset.data.length,
          "Cache-Control": "private, max-age=31536000, immutable",
          ...INERT,
        });
        response.end(asset.data);
      } else {
        const files = /^\/api\/sessions\/([\w-]+)\/files$/.exec(path);
        if (request.method === "GET" && files && uuid.test(files[1]!)) {
          await this.file(files[1]!, url.searchParams, response);
          return;
        }
        const attachments = /^\/api\/sessions\/([\w-]+)\/attachments$/.exec(path);
        // The session's files: what the person attached and what the agent made (its artifacts).
        if (request.method === "GET" && attachments && uuid.test(attachments[1]!) && !url.search) {
          sendJson(response, 200, { files: this.runtime.files(attachments[1]!) });
          return;
        }
        if (request.method === "POST" && attachments && uuid.test(attachments[1]!) && !url.search) {
          try {
            sendJson(response, 201, await this.attach(attachments[1]!, request));
          } catch (error) {
            // A refused upload is not read further; the connection closes with the answer.
            response.setHeader("Connection", "close");
            const code = failure(error);
            sendJson(response, code === "not-found" ? 404 : code === "limit" ? 413 : 400, { error: code });
          }
          return;
        }
        const attachment = /^\/api\/sessions\/([\w-]+)\/attachments\/([^/]+)$/.exec(path);
        if (request.method === "GET" && attachment && uuid.test(attachment[1]!) && !url.search) {
          await this.attachment(attachment[1]!, attachment[2]!, response);
          return;
        }
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
          await this.observe(id!, response, who.local ? undefined : who.device?.id);
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
  private async call(id: string, call: { point: string; key: string; name: string; data?: Json }, response: ServerResponse) {
    try {
      const result = await this.runtime.call(id, call.point, call.key, call.name, call.data);
      sendJson(response, 200, result === undefined ? {} : { result });
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      // The extension's own error is an answer like a result: the component shows it.
      if (error instanceof CallError) sendJson(response, 200, { error: failure(error), detail: error.detail });
      else sendJson(response, error instanceof RuntimeError && error.code === "not-found" ? 404 : 400, { error: failure(error) });
    }
  }
  /** An image part's bytes, or a chunk of a clipped text part (`?offset=`). */
  /**
   * An extension component's `host.file(path)`: a file in the folder its own placement named, as
   * it is now. Served as inert data.
   */
  /**
   * A file a person attaches: the raw bytes as the body, the name in `X-File-Name` (URI-encoded). Stored
   * in the session's `files/` folder under a free name, which is returned.
   */
  private async attach(id: string, request: IncomingMessage) {
    let name: string;
    try {
      name = decodeURIComponent(String(request.headers["x-file-name"] ?? ""));
    } catch {
      throw new RuntimeError("invalid-input");
    }
    if (request.headers["content-encoding"] || !validAttachmentName(name)) throw new RuntimeError("invalid-input");
    const length = Number(request.headers["content-length"] ?? NaN);
    if (Number.isFinite(length) && length > ATTACHMENT_MAX_BYTES) throw new RuntimeError("limit");
    const stored = await this.runtime.attach(id, name, request);
    return { ...stored, type: FILE_TYPES[extname(stored.name).toLowerCase()] ?? "application/octet-stream" };
  }
  /** An attachment, served as inert data: nothing in it may run or load, whatever it contains. */
  private async attachment(id: string, encoded: string, response: ServerResponse) {
    let file: string;
    let size: number;
    try {
      file = this.runtime.attachment(id, decodeURIComponent(encoded));
      size = (await stat(file)).size;
    } catch (error) {
      if (error instanceof RuntimeError && error.code !== "not-found" && error.code !== "invalid-input") throw error;
      sendJson(response, 404, { error: "not-found" });
      return;
    }
    response.writeHead(200, {
      "Content-Type": FILE_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": size,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(basename(file))}`,
      "Cache-Control": "no-store",
      ...INERT,
    });
    if (!size) return void response.end();
    await pipeline(createReadStream(file, { end: size - 1 }), response).catch(() => response.destroy());
  }
  private async file(id: string, query: URLSearchParams, response: ServerResponse) {
    const { point, key, path } = Object.fromEntries(query);
    if (
      [...query.keys()].some((name) => !["point", "key", "path"].includes(name)) ||
      point === undefined ||
      key === undefined ||
      path === undefined
    )
      throw new RuntimeError("invalid-input");
    let file: string;
    let size: number;
    try {
      file = this.runtime.file(id, point, key, path);
      size = (await stat(file)).size;
    } catch (error) {
      if (error instanceof RuntimeError && error.code !== "not-found") throw error;
      sendJson(response, 404, { error: "not-found" });
      return;
    }
    if (size > MAX_FILE) throw new RuntimeError("limit");
    response.writeHead(200, {
      "Content-Type": FILE_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": size,
      "Cache-Control": "no-store",
      ...INERT,
    });
    if (!size) return void response.end();
    // A file that changes or goes away while it is read ends the response; nothing else is affected.
    await pipeline(createReadStream(file, { end: size - 1 }), response).catch(() => response.destroy());
  }
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
        // An SVG is only ever drawn as an image; nothing in it may run or load.
        ...INERT,
      });
      response.end(data);
      return;
    }
    sendJson(response, 200, this.runtime.text(id, itemId, part, Number(offset)));
  }
  private async observe(id: string, response: ServerResponse, device?: string) {
    let observation;
    try {
      observation = this.runtime.observeLive(id);
    } catch (error) {
      if (!(error instanceof RuntimeError) || error.code !== "not-found") throw error;
      // Not an error: sessions unload when idle. The client opens it again and reconnects.
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      response.end(`event: unloaded
data: ${JSON.stringify({ type: "unloaded", sessionId: id } satisfies LiveEvent)}

`);
      return;
    }
    this.streams.set(response, device);
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
  /**
   * The workspace stream: `ready` once listening (the client reads everything then), then which areas
   * changed. Ends after five minutes; the client follows on at once and reads everything again.
   */
  private async watchWorkspace(response: ServerResponse, device?: string) {
    if (this.workspaceStreams >= 16) throw new RuntimeError("limit");
    this.workspaceStreams++;
    this.streams.set(response, device);
    let pending: WorkspaceArea[] = [];
    let wake: (() => void) | undefined;
    const stop = this.workspace.listen((areas) => {
      pending = [...new Set([...pending, ...areas])];
      wake?.();
    });
    let gone = false;
    const ended = new Promise<void>((resolve) => response.once("close", resolve)).then(() => void (gone = true));
    const lifetime = setTimeout(() => response.end(), 5 * 60_000);
    const frame = (event: string, data: unknown) => `event: ${event}
data: ${JSON.stringify(data)}

`;
    try {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
      response.write(frame("ready", { type: "ready" }));
      while (!gone && !response.destroyed && !response.writableEnded) {
        if (!pending.length) {
          await Promise.race([ended, new Promise<void>((resolve) => (wake = resolve))]);
          wake = undefined;
          continue;
        }
        const areas = pending;
        pending = [];
        // A reader that stops reading is dropped rather than buffered for.
        if (!response.write(frame("changed", { type: "changed", areas } satisfies WorkspaceChange))) {
          const drained = await Promise.race([once(response, "drain").then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 2000))]);
          if (!drained) response.destroy();
        }
      }
    } finally {
      stop();
      clearTimeout(lifetime);
      this.streams.delete(response);
      this.workspaceStreams--;
      if (!response.writableEnded) response.end();
    }
  }
  async shutdown() {
    this.closed = true;
    this.untouch();
    this.workspace.close();
    for (const stream of this.streams.keys()) stream.end();
    // Both owners begin cleanup even if the other throws or never settles.
    const results = await Promise.allSettled([
      Promise.resolve().then(() => this.providers?.shutdown()),
      Promise.resolve().then(() => this.runtime.shutdown()),
    ]);
    const failure = results.find((r) => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}
