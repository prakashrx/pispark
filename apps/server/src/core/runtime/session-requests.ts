import { join } from "node:path";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { HOLD_CHANNEL, type HoldRequest } from "../../contract/protocol.js";
import { API_CHANNEL, RESULT_CHANNEL, VERB_CHANNEL, verbs, type Answer, type Verb, type VerbMessage } from "../../contract/verbs.js";
import { describeSchedule, parseCron } from "../../contract/cron.js";
import { validItemName } from "../agents/format.js";
import type { ExtensionUI } from "../extensions/extension-ui.js";
import { runtimeError } from "./errors.js";
import { extensionNameValid } from "./extension-revisions.js";
import { EXTENSION_CHANNEL, type ExtensionMessage } from "./extension-tool.js";
import { validResultData, validVerb } from "./verbs.js";
import type { Session, SessionHost } from "./session.js";

const UNAVAILABLE: Answer = { ok: false, text: "Not available here." };

/** What the requests need of the session that is not public. */
export interface RequestState {
  ui(): ExtensionUI | undefined;
  /** The session is closing or stopped. */
  closed(): boolean;
  /** The current run was cancelled. */
  cancelled(): boolean;
  /** The session's state as JSON, for `pispark_self inspect`. */
  inspect(): string;
}

/**
 * What a session's tools and extensions ask of PiSpark on the session's event bus: the ten verbs
 * about what it started (`contract/verbs.ts`), keeping it loaded, changing its extensions, and
 * setting the data its answer carries.
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
      bus.on(VERB_CHANNEL, (message) => this.verb(message)),
      // An extension asks for the verbs as functions: the same messages, sent for it.
      bus.on(API_CHANNEL, (take) => typeof take === "function" && take(verbs(bus))),
      ...(development ? [bus.on(EXTENSION_CHANNEL, (message) => void this.extension(message))] : []),
      bus.on(HOLD_CHANNEL, (message) => this.hold(message)),
      bus.on(RESULT_CHANNEL, (message) => {
        const data = (message as { data?: unknown } | undefined)?.data;
        if (validResultData(data)) this.session.resultData = structuredClone(data);
      }),
    ];
    return () => off.forEach((each) => each());
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

  /**
   * One of the ten verbs, from a built-in tool or an extension in this session. The session answers
   * for itself (`self`, at once) and asks the person before a schedule is added; the rest is about
   * what it started.
   */
  private verb(value: unknown): void {
    const message = value as VerbMessage | undefined;
    if (!message || typeof message !== "object" || typeof message.reply !== "function") return;
    message.taken = true;
    const { request, signal } = message;
    if (!validVerb(request))
      return message.reply({ ok: false, text: "That request is not well formed. Check its fields: a pattern must be a regular expression, and a schedule takes exactly one of cron, in_minutes or at." });
    if (request.verb === "self") return message.reply(this.self(request.action));
    const { started } = this.host;
    void (request.verb === "schedule" ? this.schedule(request) : started ? started.say(this.session.id, request, signal) : Promise.resolve(UNAVAILABLE))
      .catch((error: unknown) => ({ ok: false, text: `That did not work (${runtimeError(error, "execution").code}).` }))
      .then((answer) => message.reply(answer));
  }

  /** The calling session: what it has loaded, or a reload with its agent's current setup when this turn ends. */
  private self(action: "inspect" | "reload"): Answer {
    if (action === "inspect") {
      try {
        return { ok: true, text: this.state.inspect() };
      } catch {
        return { ok: false, text: "Cannot read this session's extension state." };
      }
    }
    const scheduled = !this.state.closed() && this.session.published && !!this.host.requestSetup?.(this.session, { asked: "pispark_self (reload)" });
    return scheduled
      ? { ok: true, text: "The session reloads when this turn ends, picking up its agent's current setup, and you get the outcome as a new message. End your turn now rather than checking." }
      : { ok: false, text: "This session cannot reload now." };
  }

  /** A schedule is added only after the person says yes, and only one that can be kept is put to them. */
  private async schedule(request: Extract<Verb, { verb: "schedule" }>): Promise<Answer> {
    const { schedules, started } = this.host;
    const ui = this.state.ui();
    if (!schedules || !started || !ui) return UNAVAILABLE;
    const id = this.session.id;
    const time = request.in_minutes !== undefined ? Date.now() + request.in_minutes * 60_000 : new Date(request.at ?? "").getTime();
    if (request.cron !== undefined ? !parseCron(request.cron) : Number.isNaN(time) || time <= Date.now()) return { ok: false, text: "That is not a time that can be scheduled." };
    const when = request.cron !== undefined ? { cron: request.cron } : { at: new Date(time).toISOString() };
    const input = { ...when, prompt: request.prompt, ...(request.run ? { run: request.run } : {}) };
    try {
      schedules.validate(id, input);
    } catch {
      return { ok: false, text: "That schedule can't be kept as given, so the person wasn't asked. A session started by another one can't use run 'new', and the time must be ahead." };
    }
    const title = request.run === "new" ? "Schedule this as new sessions under this one?" : "Schedule this in this session?";
    if (!(await ui.context.confirm(title, `${describeSchedule(when)}: ${request.prompt}`))) return { ok: true, text: "The person declined; nothing was scheduled." };
    const added = schedules.add(id, input, "agent");
    const where = added.run === "new" ? "each run in a new session" : "in this session";
    return {
      ok: true,
      text: `Scheduled (${started.handle(id, "schedule", added.id)}): ${describeSchedule(added)}, ${where}. The person can change it under Session info → Schedules.`,
      details: { schedule: added },
    };
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
}
