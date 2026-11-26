import { join } from "node:path";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { HOLD_CHANNEL, type HoldRequest } from "../../contract/protocol.js";
import type { Schedule } from "../../contract/schedule-protocol.js";
import { describeSchedule, parseCron } from "../../contract/cron.js";
import { validItemName } from "../agents/format.js";
import type { ExtensionUI } from "../extensions/extension-ui.js";
import { runtimeError } from "./errors.js";
import { extensionNameValid } from "./extension-revisions.js";
import { EXTENSION_CHANNEL, type ExtensionMessage } from "./extension-tool.js";
import { PROCESS_CHANNEL, validProcessMessage } from "./process-tool.js";
import { SCHEDULE_CHANNEL, validMessage, type ScheduleAnswer, type ScheduleMessage } from "./schedule-tool.js";
import { RESULT_CHANNEL, SESSION_CHANNEL, validResultData, validSessionMessage } from "./session-tool.js";
import type { Session, SessionHost } from "./session.js";

/** What the requests need of the session that is not public. */
export interface RequestState {
  ui(): ExtensionUI | undefined;
  /** The session is closing or stopped. */
  closed(): boolean;
  /** The current run was cancelled. */
  cancelled(): boolean;
  /** The session's state as JSON, for `pispark_session inspect`. */
  inspect(): string;
}

/**
 * What a session's tools and extensions ask of PiSpark on the session's event bus: keep it loaded,
 * run processes, start and follow sessions, schedule it, change its extensions, and set its result.
 */
export class SessionRequests {
  /** A project extension's activation waits for the person's yes. */
  private approving = false;

  constructor(
    private readonly session: Session,
    private readonly host: SessionHost,
    private readonly state: RequestState,
  ) {}

  /** Listens on the bus; `development` adds the extension tool's channel. Returns how to stop. */
  bind(bus: EventBus, development: boolean): () => void {
    const off = [
      bus.on(SESSION_CHANNEL, (message) => this.sessions(message)),
      ...(development ? [bus.on(EXTENSION_CHANNEL, (message) => void this.extension(message))] : []),
      bus.on(HOLD_CHANNEL, (message) => this.hold(message)),
      bus.on(PROCESS_CHANNEL, (message) => this.processes(message)),
      bus.on(RESULT_CHANNEL, (message) => {
        const data = (message as { data?: unknown } | undefined)?.data;
        if (validResultData(data)) this.session.resultData = structuredClone(data);
      }),
    ];
    return () => off.forEach((each) => each());
  }

  /** Listens for the schedule tool. Returns how to stop. */
  bindSchedules(bus: EventBus): () => void {
    return bus.on(SCHEDULE_CHANNEL, (message) => this.schedule(message));
  }

  /** An extension asks to keep this session loaded, or lets go (`HOLD_CHANNEL`). */
  private hold(value: unknown): void {
    const message = value as HoldRequest | undefined;
    const reply = typeof message?.reply === "function" ? message.reply : () => {};
    if (
      !message ||
      typeof message !== "object" ||
      !validItemName(message.extension) ||
      typeof message.hold !== "boolean" ||
      (message.hold && (typeof message.reason !== "string" || !message.reason.trim() || message.reason.length > 200))
    )
      return reply({ state: "refused", text: "Give the extension's name, hold, and (to hold) a short reason." });
    const answer = this.host.hold?.(this.session, { extension: message.extension, hold: message.hold, reason: message.reason?.trim() ?? "" }) ?? {
      state: "refused" as const,
      text: "Holding is not available here.",
    };
    reply(answer);
  }

  /** The built-in process tool (or an extension in this session): its own processes and its children's. */
  private processes(value: unknown): void {
    if (!validProcessMessage(value)) return;
    value.taken = true;
    const processes = this.host.processes;
    void (processes ? processes.request(this.session.id, value.request, value.signal) : Promise.resolve({ ok: false, text: "Background processes are not available here." }))
      .catch((error: unknown) => ({ ok: false, text: `That did not work (${runtimeError(error, "execution").code}).` }))
      .then((answer) => value.reply(answer));
  }

  /** The built-in session tool (or an extension in this session): its own children only. */
  private sessions(value: unknown): void {
    if (!validSessionMessage(value)) return;
    value.taken = true;
    if (value.request.action === "inspect") {
      try {
        value.reply({ ok: true, text: this.state.inspect() });
      } catch {
        value.reply({ ok: false, text: "Cannot read this session's extension state." });
      }
      return;
    }
    if (value.request.action === "reload") {
      const scheduled = !this.state.closed() && this.session.published && !!this.host.requestSetup?.(this.session, { asked: "pispark_session (reload)" });
      value.reply(
        scheduled
          ? { ok: true, text: "The session reloads when this turn ends, picking up its agent's current setup, and you get the outcome as a new message. End your turn now rather than checking." }
          : { ok: false, text: "This session cannot reload now." },
      );
      return;
    }
    if (this.session.metadata.parent && value.request.action !== "report") {
      value.reply({ ok: false, text: "Child sessions cannot manage other sessions." });
      return;
    }
    const sessions = this.host.sessions;
    void (sessions ? sessions.request(this.session.id, value.request) : Promise.resolve({ ok: false, text: "Starting sessions is not available here." }))
      .catch((error: unknown) => ({ ok: false, text: `That did not work (${runtimeError(error, "execution").code}).` }))
      .then((answer) => value.reply(answer));
  }

  /** The extension tool: stage, apply, unload or reload one of the session's own extensions. */
  private async extension(value: unknown): Promise<void> {
    const message = value as ExtensionMessage;
    if (!message?.request || typeof message.reply !== "function") return;
    message.taken = true;
    const { request, signal, reply } = message;
    const session = this.session;
    const revisions = session.extensionRevisions;
    try {
      if (signal?.aborted || this.state.closed() || !session.published || session.status !== "running") throw new Error("No active run.");
      if (this.host.extensionPending?.(session.id)) throw new Error("A reload is already pending.");
      if (this.approving) throw new Error("A revision is awaiting approval.");
      const folder = this.host.storage.directory(session.id);
      const draftRoot = join(folder, "extension-drafts");
      const assertQueue = () => {
        if (signal?.aborted || this.state.closed() || this.state.cancelled()) throw new Error("The extension change cannot be scheduled while this turn is stopping.");
      };
      let change = revisions.read().staged;
      if (request.action === "apply" || request.action === "unload") {
        assertQueue();
        if (!extensionNameValid(request.name)) throw new Error("Invalid extension name.");
        const active = revisions.read().active.find((item) => item.name === request.name);
        if (request.action === "unload" && !active) return reply("That extension is already unloaded.");
        change = request.action === "apply" ? revisions.stage(draftRoot, request.name, request.name, folder) : revisions.stage(session.metadata.cwd, request.name);
        if (active && change.snapshot === active.snapshot) {
          const { staged: _staged, ...state } = revisions.read();
          revisions.write(state);
          return reply(`${change.name} is already active at revision ${active.revision}.`);
        }
      } else if (request.action === "stage" || request.action === "remove") {
        if (!extensionNameValid(request.name) || (request.action === "stage" && !request.source)) throw new Error("Invalid extension name or source.");
        const local = request.action === "stage" && request.scope === "session";
        change = revisions.stage(local ? draftRoot : session.metadata.cwd, request.name, request.action === "stage" ? request.source : undefined, local ? folder : undefined);
        return reply(`Staged ${change.name} at revision ${change.revision}. Active code has not changed.`);
      }
      if (!change || (request.action === "reload" && change.revision !== request.revision)) throw new Error("Give the exact currently staged revision.");
      revisions.verify(change);
      if (change.snapshot && change.scope !== "session") {
        this.approving = true;
        try {
          const yes = await this.state.ui()?.context.confirm(
            "Activate this project extension in the session?",
            [`${change.name} (${change.source})`, `Revision: ${change.revision}`, "Extension code runs with the host user's permissions."].join("\n"),
          );
          if (!yes) return reply("Activation declined. The active revision is unchanged.");
        } finally {
          this.approving = false;
        }
      }
      assertQueue();
      const what = `${change.snapshot ? "activation" : "unload"} of ${change.name}`;
      if (!this.host.requestSetup?.(session, { extension: change.revision, asked: `pispark_extension (${what} at revision ${change.revision})` }))
        throw new Error("A reload is already pending.");
      reply(`Scheduled ${what} when this turn ends. The session then reloads and you get the outcome as a new message; end your turn now rather than checking.`);
    } catch (error) {
      reply((error as Error).message.slice(0, 500), true);
    }
  }

  /** The built-in schedule tool: list, remove, or add after the person says yes. */
  private schedule(value: unknown): void {
    if (!validMessage(value)) return;
    const message: ScheduleMessage = value;
    message.taken = true;
    const schedules = this.host.schedules;
    const id = this.session.id;
    // Where each run goes and how it reports, as saved: the agent sees what was made, not what it asked for.
    const where = (s: Schedule) => (s.run === "new" ? `as a new session, reports ${s.report ?? "status"}` : "in this session");
    const answer = async (): Promise<ScheduleAnswer> => {
      const ui = this.state.ui();
      if (!schedules || !ui) return { ok: false, text: "Scheduling is not available here." };
      const { request } = message;
      const mine = schedules.of(id);
      if (request.action === "list")
        return {
          ok: true,
          text: mine.length ? mine.map((s) => `${s.id}: ${describeSchedule(s)}, ${where(s)} (${s.on ? "on" : "off"}): ${s.prompt}`).join("\n") : "This session has no schedules.",
          schedules: mine,
        };
      if (request.action === "remove") {
        if (!mine.some((s) => s.id === request.id)) return { ok: false, text: "This session has no schedule with that id." };
        schedules.remove(request.id);
        return { ok: true, text: "Schedule removed." };
      }
      const { input } = request;
      const when = { cron: input.cron, at: input.at };
      if (input.cron !== undefined ? !parseCron(input.cron) : Number.isNaN(new Date(input.at ?? "").getTime()) || new Date(input.at!).getTime() <= Date.now())
        return { ok: false, text: "That is not a time that can be scheduled." };
      const how = { ...(input.run !== undefined ? { run: input.run } : {}), ...(input.report !== undefined ? { report: input.report } : {}) };
      const title = how.run === "new" ? "Schedule this as new sessions under this one?" : "Schedule this in this session?";
      const yes = await ui.context.confirm(title, `${describeSchedule(when)}: ${input.prompt ?? ""}`);
      if (!yes) return { ok: true, text: "The person declined; nothing was scheduled." };
      const added = schedules.add(id, { ...when, ...how, prompt: input.prompt }, "agent");
      return {
        ok: true,
        text: `Scheduled: ${describeSchedule(added)}, ${where(added)} (id ${added.id}). The person can change it under Session info → Schedules.`,
        schedule: added,
      };
    };
    void answer()
      .catch((error: unknown) => ({ ok: false, text: `Scheduling failed (${runtimeError(error, "execution").code}).` }))
      .then((result) => message.reply(result));
  }
}
