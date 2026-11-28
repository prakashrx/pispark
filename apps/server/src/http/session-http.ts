import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { validEvents, type NotificationState } from "../contract/notification-protocol.js";
import type { Catalog } from "../contract/protocol.js";
import type { ScheduleInput } from "../contract/schedule-protocol.js";
import type { Json } from "../contract/stream-ops.js";
import { CallError } from "../core/extensions/views.js";
import { HostLink } from "../core/host-link.js";
import { correlated, requestId, silentLogger, type SafeLogger } from "../core/logger.js";
import type { RemoteAccess } from "../core/remote/remote-access.js";
import { type SessionRuntime, RuntimeError } from "../core/runtime/session-runtime.js";
import { AgentHttp } from "./agent-http.js";
import { Commands, validCommand } from "./commands.js";
import { HostHttp } from "./host-http.js";
import { UUID, body, failure, sendJson } from "./io.js";
import { LiveStreams } from "./live-streams.js";
import { Notifications } from "./notifications.js";
import type { ProviderHttp } from "./provider-http.js";
import { validEndpoint } from "./push.js";
import { RemoteHttp, type Admission } from "./remote-http.js";
import { SessionFiles } from "./session-files.js";
import { WorkspaceLive } from "./workspace-live.js";

/** A history page may carry one large item. */
const ITEMS_FRAME = 1024 * 1024;

/** An extension component's call: which placement, which of its functions, and optional JSON data. */
function validCall(value: unknown): { point: string; key: string; name: string; data?: Json } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RuntimeError("invalid-input");
  const c = value as Record<string, unknown>;
  const keys = ["point", "key", "name", ...("data" in c ? ["data"] : [])];
  const short = (value: unknown, empty = false) => typeof value === "string" && (empty ? /^[\w.:-]{0,64}$/ : /^[\w.:-]{1,80}$/).test(value);
  if (Object.keys(c).length !== keys.length || !keys.every((key) => key in c) || !short(c.point) || !short(c.key, true) || !short(c.name))
    throw new RuntimeError("invalid-input");
  // SAFETY: exact keys and every field validated above; the body limit bounds `data`.
  return c as { point: string; key: string; name: string; data?: Json };
}

/**
 * The HTTP API: who may ask (admission), and which route answers. Commands, live streams and the
 * bytes a session serves have modules of their own; the agent, provider, host and remote APIs too.
 */
export class SessionHttp {
  private requests = 0;
  private closed = false;
  private readonly agents: AgentHttp;
  private readonly host: HostHttp;
  private readonly remote?: RemoteHttp;
  private readonly commands: Commands;
  private readonly files: SessionFiles;
  private readonly live: LiveStreams;
  private readonly workspace: WorkspaceLive;
  private readonly notifications: Notifications;
  private readonly untouch: () => void;
  private stopNotifying?: () => void;

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
    this.commands = new Commands(runtime);
    this.files = new SessionFiles(runtime);
    this.workspace = new WorkspaceLive({
      sessions: () => [this.runtime.list(), this.runtime.archived().length, this.runtime.unreadableSessions],
      schedules: () => this.runtime.listSchedules(),
      routines: () => this.runtime.listRoutines(),
      processes: () => this.runtime.runningProcesses(),
      host: () => this.host.changes(),
    });
    this.live = new LiveStreams(runtime, this.workspace);
    this.untouch = runtime.onTouched(() => this.workspace.poke());
    this.notifications = new Notifications(join(runtime.dataFolder, "notifications"), () => this.runtime.list());
    this.watchForNotifications();
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    return correlated({ requestId: requestId() }, () => this.handleRequest(request, response));
  }

  async shutdown() {
    this.closed = true;
    this.untouch();
    this.workspace.close();
    this.live.endAll();
    // Both owners begin cleanup even if the other throws or never settles.
    const results = await Promise.allSettled([
      Promise.resolve().then(() => this.providers?.shutdown()),
      Promise.resolve().then(() => this.runtime.shutdown()),
    ]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  /**
   * Only requests on a loopback socket, for this server's loopback Host, or for the remote address
   * while remote access is on (Tailscale Serve proxies it to loopback). Same-origin only.
   */
  private admit(request: IncomingMessage): Admission | undefined {
    const socket = request.socket.localAddress;
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(socket ?? "")) return;
    const port = request.socket.localPort;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    const host = request.headers.host;
    const local = !!host && hosts.includes(host);
    if (!host || (!local && host !== this.remote?.host)) return;
    // Proxies (Tailscale Serve among them) mark what they forward. A forwarded request is never this
    // computer, even if a proxy rewrote its Host to a loopback one.
    if (local && (request.headers["x-forwarded-for"] || request.headers["tailscale-user-login"])) return;
    const origin = request.headers.origin;
    if (origin && origin !== (local ? `http://${host}` : `https://${host}`) && !(local && origin === this.developmentOrigin)) return;
    if (request.headers["sec-fetch-site"] === "cross-site") return;
    // Non-browser clients may omit Origin. Browser mutations must carry it.
    if (request.method === "POST" && request.headers["sec-fetch-site"] && !origin) return;
    if (local) return { local: true };
    const device = this.remote!.device(request);
    return { local: false, ...(device ? { device } : {}) };
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const who = this.admit(request);
    if (!who) {
      this.logger.event("http.reject", { outcome: "rejected", code: "forbidden" });
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    if (this.closed || this.requests >= 32) {
      sendJson(response, 503, { error: "limit" });
      return;
    }
    this.requests++;
    try {
      await this.route(request, response, who);
    } catch (error) {
      this.logger.event("http.failure", { outcome: "failed", code: failure(error) }, "error");
      if (response.headersSent) response.destroy();
      else sendJson(response, 400, { error: failure(error) });
    } finally {
      this.requests--;
    }
  }

  private async route(request: IncomingMessage, response: ServerResponse, who: Admission): Promise<void> {
    const url = new URL(request.url!, "http://localhost");
    const path = url.pathname;
    const method = request.method;
    const plain = !url.search;
    const device = who.local ? undefined : who.device?.id;
    const remotePath = path === "/api/remote" || path.startsWith("/api/remote/");
    // A device at the remote address that hasn't paired may only ask what it is, and pair.
    if (!who.local && !who.device && !(remotePath && ["/api/remote/me", "/api/remote/pair"].includes(path)))
      return sendJson(response, 401, { error: "unpaired" });
    if (remotePath && this.remote && plain) return this.remote.handle(request, response, path, who);
    if (path === "/api/agents" || path.startsWith("/api/agents/")) return this.agents.handle(request, response);
    if (path.startsWith("/api/notifications/") && plain && method === "POST") return this.notify(path, request, response, device ?? "local");
    if (path === "/api/live" && plain && method === "GET") return this.live.workspaceChanges(response, device);
    if (path === "/api/host" && plain) return this.host.handle(request, response);
    if (path === "/api/host/notes" && plain && method === "GET") return this.host.notes(response);
    if (path.startsWith("/api/providers") && this.providers) return this.providers.handle(request, response);
    if (path === "/api/settings" && plain && (method === "GET" || method === "POST"))
      return sendJson(response, 200, method === "GET" ? this.runtime.settings() : this.runtime.updateSettings(await body(request)));
    if (await this.background(request, response, path, url)) return;

    if (method === "POST" && path === "/api/commands" && plain) return sendJson(response, 202, this.commands.submit(validCommand(await body(request))));
    if (method === "GET" && /^\/api\/receipts\/[\w-]+$/.test(path) && plain) {
      const receipt = this.commands.receipt(path.split("/").at(-1)!);
      return sendJson(response, receipt ? 200 : 404, receipt ?? { error: "unknown-receipt" });
    }
    if (method === "GET" && path === "/api/catalog" && plain)
      return sendJson(response, 200, { home: homedir(), recentFolders: this.runtime.recentFolders() } satisfies Catalog);
    if (method === "GET" && path === "/api/sessions" && (plain || url.search === "?archived")) {
      // The sessions in use, or (`?archived`) the ones put away; the newest 256 either way.
      const archived = this.runtime.archived();
      const sessions = (plain ? this.runtime.list() : archived).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return sendJson(response, 200, { sessions: sessions.slice(-256), truncated: sessions.length > 256, unreadable: this.runtime.unreadableSessions, archived: archived.length });
    }
    const view = /^\/api\/views\/([a-f0-9]{32})\.js$/.exec(path);
    if (method === "GET" && view && plain) return this.files.component(view[1]!, response);
    const asset = /^\/api\/views\/assets\/([a-f0-9]{32}\.[a-z0-9]{2,5})$/.exec(path);
    if (method === "GET" && asset && plain) return this.files.asset(asset[1]!, response);
    await this.session(request, response, url, device);
  }

  /** `/api/sessions/<id>/…`: one session, its files, its history, its live document. */
  private async session(request: IncomingMessage, response: ServerResponse, url: URL, device: string | undefined): Promise<void> {
    const path = url.pathname;
    const method = request.method;
    const plain = !url.search;
    const sub = /^\/api\/sessions\/([\w-]+)(\/.*)?$/.exec(path);
    const id = sub && UUID.test(sub[1]!) ? sub[1]! : undefined;
    const rest = sub?.[2] ?? "";
    if (id && method === "GET" && rest === "/files") return this.files.file(id, url.searchParams, response);
    // The session's files: what the person attached and what the agent made (its artifacts).
    if (id && rest === "/attachments" && plain) {
      if (method === "GET") return sendJson(response, 200, { files: this.runtime.files(id) });
      if (method === "POST") {
        try {
          return sendJson(response, 201, await this.files.attach(id, request));
        } catch (error) {
          // A refused upload is not read further; the connection closes with the answer.
          response.setHeader("Connection", "close");
          const code = failure(error);
          return sendJson(response, code === "not-found" ? 404 : code === "limit" ? 413 : 400, { error: code });
        }
      }
    }
    const attachment = /^\/attachments\/([^/]+)$/.exec(rest);
    if (id && method === "GET" && attachment && plain) return this.files.attachment(id, attachment[1]!, response);
    if (id && method === "POST" && rest === "/calls" && plain) return this.call(id, validCall(await body(request)), response);
    if (id && method === "GET" && rest === "" && plain) return sendJson(response, 200, this.runtime.session(id));
    const match = /^\/(live|items)(?:\/([\w-]{1,64})\/parts\/(\d{1,3}))?$/.exec(rest);
    if (!id || method !== "GET" || !match) return sendJson(response, 404, { error: "not-found" });
    const [, kind, itemId, part] = match;
    if (kind === "live" && plain && !itemId) return this.live.session(id, response, device);
    if (kind === "items" && itemId) return this.files.part(id, itemId, Number(part), url.searchParams, response);
    if (kind === "items") return sendJson(response, 200, this.runtime.items(id, historyQuery(url.searchParams)), ITEMS_FRAME);
    sendJson(response, 400, { error: "invalid-input" });
  }

  /** Schedules, background processes and routines. True when one of their routes answered. */
  private async background(request: IncomingMessage, response: ServerResponse, path: string, url: URL): Promise<boolean> {
    const method = request.method;
    const plain = !url.search;
    // Schedules: every one (`GET`), add one (`POST`), change, run now or remove one (`POST`).
    if (path === "/api/schedules" && plain && (method === "GET" || method === "POST")) {
      if (method === "GET") sendJson(response, 200, this.runtime.listSchedules(), 1024 * 1024);
      else sendJson(response, 201, this.runtime.addSchedule((await body(request)) as ScheduleInput));
      return true;
    }
    const schedule = /^\/api\/schedules\/([\w-]+)(?:\/(run|remove))?$/.exec(path);
    if (schedule && method === "POST" && UUID.test(schedule[1]!) && plain) {
      const [, id, action] = schedule;
      if (action === "run") {
        await this.runtime.runSchedule(id!);
        sendJson(response, 202, {});
      } else if (action === "remove") {
        this.runtime.removeSchedule(id!);
        sendJson(response, 200, {});
      } else sendJson(response, 200, this.runtime.updateSchedule(id!, (await body(request)) as ScheduleInput));
      return true;
    }
    // Processes: every one still running; a session's; one's output after a point; stop one.
    if (path === "/api/processes" && plain && method === "GET") {
      sendJson(response, 200, this.runtime.runningProcesses(), 1024 * 1024);
      return true;
    }
    const processes = /^\/api\/sessions\/([\w-]+)\/processes(?:\/([\w-]+)\/(output|stop))?$/.exec(path);
    if (processes && UUID.test(processes[1]!)) {
      const [, sessionId, id, action] = processes;
      if (!action && method === "GET" && plain) {
        sendJson(response, 200, { processes: this.runtime.listProcesses(sessionId!) });
        return true;
      }
      if (action === "output" && method === "GET") {
        sendJson(response, 200, this.runtime.processOutput(sessionId!, id!, Number(url.searchParams.get("since") ?? "0")), 1024 * 1024);
        return true;
      }
      if (action === "stop" && method === "POST" && plain) {
        this.runtime.stopProcess(sessionId!, id!);
        sendJson(response, 202, {});
        return true;
      }
    }
    // Routines agents offer: every one (`GET`), switch one on or off (`POST {on}`), run one now.
    if (path === "/api/routines" && plain && method === "GET") {
      sendJson(response, 200, this.runtime.listRoutines(), 1024 * 1024);
      return true;
    }
    const routine = /^\/api\/routines\/([a-z0-9-]+)\/([A-Za-z0-9._-]+)(?:\/(run))?$/.exec(path);
    if (routine && method === "POST" && plain) {
      const [, agent, id, action] = routine;
      if (action === "run") {
        await this.runtime.runRoutine(agent!, id!);
        sendJson(response, 202, {});
      } else sendJson(response, 200, this.runtime.setRoutine(agent!, id!, ((await body(request)) as { on?: unknown } | undefined)?.on));
      return true;
    }
    return false;
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
        return sendJson(response, 200, { publicKey: this.notifications.keys.publicKey, ...this.notifications.state(device, endpoint) } satisfies NotificationState);
      case "/api/notifications/subscribe":
        if (!endpoint || !validEvents(input.events)) throw new RuntimeError("invalid-input");
        this.notifications.subscribe(device, endpoint, input.events);
        this.watchForNotifications();
        return sendJson(response, 200, {});
      case "/api/notifications/unsubscribe":
        if (!endpoint) throw new RuntimeError("invalid-input");
        this.notifications.unsubscribe(device, endpoint);
        this.watchForNotifications();
        return sendJson(response, 200, {});
      case "/api/notifications/test":
        if (!endpoint) throw new RuntimeError("invalid-input");
        return sendJson(response, 200, { sent: await this.notifications.test(device, endpoint) });
      case "/api/notifications/pending":
        if (!endpoint) throw new RuntimeError("invalid-input");
        return sendJson(response, 200, { notifications: this.notifications.take(device, endpoint) });
      case "/api/notifications/presence":
        if (typeof input.page !== "string" || !/^[\w-]{1,64}$/.test(input.page) || typeof input.visible !== "boolean") throw new RuntimeError("invalid-input");
        this.notifications.present(device, input.page, input.visible);
        return sendJson(response, 200, {});
    }
    sendJson(response, 404, { error: "not-found" });
  }

  /** Ends the live streams of one paired device, or of every remote device; a removed device is told nothing more. */
  private endRemote(device?: string) {
    this.live.endRemote(device);
    if (device !== undefined) {
      this.notifications.forgetDevice(device);
      this.watchForNotifications();
    }
  }
}

/** A history page's query: `before` or `after` an item, and how many. */
function historyQuery(query: URLSearchParams): { before?: string; after?: string; limit?: number } {
  const { before, after, limit } = Object.fromEntries(query);
  const token = /^[\w-]{1,64}$/;
  if (
    [...query.keys()].some((key) => !["before", "after", "limit"].includes(key)) ||
    (before !== undefined && (!token.test(before) || after !== undefined)) ||
    (after !== undefined && !token.test(after)) ||
    (limit !== undefined && !/^\d{1,3}$/.test(limit))
  )
    throw new RuntimeError("invalid-input");
  return { before, after, limit: limit === undefined ? undefined : Number(limit) };
}
