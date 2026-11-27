import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_RECORDS_KEPT,
  MAX_WAITING_PER_SOURCE,
  type WakeRecord,
  type WakeSource,
  type WokenCard,
  type WokenDetails,
} from "../../contract/wake-protocol.js";
import type { ChildEnded } from "../../contract/verbs.js";
import { validResultData } from "./verbs.js";
import { silentLogger, type SafeLogger } from "../logger.js";
import { writeAtomic } from "../files.js";
import { RuntimeError, runtimeError } from "./errors.js";
import type { RunResult } from "./session.js";

/** One ask from a source: the message to send, when it was due, and how it waits. */
export interface Wake {
  source: WakeSource;
  text: string;
  due: string;
  /**
   * How it waits while the session is busy. `latest`: one waiting wake stands for every later one
   * (a clock: only the latest time matters). `queue`: each waits, in order (every message matters).
   */
  policy: "latest" | "queue";
  /** It came due while PiSpark was not running. */
  late?: true;
  /**
   * What it is, when something the session started says it: its answer (a child session's, or a
   * process's end), or a raise. An answer the session has taken by the time it would be sent is
   * dropped; a raise ends a wait early.
   */
  word?: "answer" | "raise";
  /** Its delivery is a line in the conversation, not a turn: the answer of a run the clock asked for. */
  quiet?: true;
  /**
   * A child's report: what the session's extensions are offered before its agent hears of it (see
   * `CHILD_ENDED_CHANNEL`), with the data an extension in the child set.
   */
  report?: Omit<ChildEnded, "reply">;
  /** How the conversation shows it, when it is a report (see `WokenCard`). */
  card?: WokenCard;
}

/** What delivery needs from the runtime that holds the sessions. */
export interface WakeHost {
  /** Every session there is, and whether it is archived. */
  sessions(): { id: string; archived: boolean }[];
  /** The session folders there are, read without loading anything (at start). */
  ids(): string[];
  /** The session's folder, where its `wakes.json` lives beside `session.json`. */
  directory(sessionId: string): string;
  /** Whether a message could be sent now: the session is not loaded, or loaded with nothing going on. */
  free(sessionId: string): boolean;
  /**
   * What a wake sends, now that its session is free: its text (an extension may have reworded it),
   * or nothing when it is settled without a message: the session has it already, an extension took
   * it, or it is a line. Loads the session if needed. Throws `busy`.
   */
  settle(sessionId: string, wake: Wake): Promise<string | undefined>;
  /** Sends one message to the session, which then runs (or waits for a run slot). Throws `busy`. */
  send(sessionId: string, text: string, details: WokenDetails): { completion: Promise<RunResult> };
  /** Pause all unattended runs, from the host's settings. */
  paused(): boolean;
}

/** One session's wakes, as `wakes.json` keeps them. */
interface State {
  /** Wakes waiting for the session, oldest first. */
  waiting: Wake[];
  /** The last records of each source, newest first. */
  records: Record<string, WakeRecord[]>;
}

const MAX_TEXT = 64 * 1024;
const OUTCOMES = ["ran", "failed", "cancelled", "missed", "started", "handled"];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const REASONS = ["busy", "off", "paused", "full"];

/** A source in a session, for the runs in flight. */
const key = (sessionId: string, sourceId: string) => `${sessionId}/${sourceId}`;
/** Messages that arrive together are one message of at most this much text; the rest follow in the next. */
const MAX_TOGETHER = MAX_TEXT / 2;

/** One message for what arrives together: each part's text in order, and what the conversation needs to show each. */
export function together(parts: { wake: Wake; text: string }[]): [string, WokenDetails] {
  // A reworded part has no line of its own before the report, so its card starts at the beginning.
  const card = ({ wake, text }: (typeof parts)[number]) => (wake.card ? { card: text === wake.text ? wake.card : { ...wake.card, start: 0 } } : {});
  const first = parts[0]!;
  const details: WokenDetails = { source: first.wake.source, due: first.wake.due, ...card(first) };
  if (parts.length === 1) return [first.text, details];
  let message = "";
  const each = parts.map((part) => {
    message += (message ? "\n\n" : "") + part.text;
    return { source: part.wake.source, ...card(part), at: message.length - part.text.length };
  });
  return [message, { ...details, together: each }];
}
const time = (value: string) => new Date(value).getTime();
const validTime = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && !Number.isNaN(time(value));
const shortString = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function validSource(value: unknown): value is WakeSource {
  return object(value) && ["schedule", "session", "process", "reload"].includes(value.kind as string) && shortString(value.id, 200) && shortString(value.label, 200);
}
function validReport(value: unknown): boolean {
  return (
    object(value) &&
    typeof value.session === "string" &&
    UUID.test(value.session) &&
    shortString(value.title, 200) &&
    shortString(value.how, 40) &&
    typeof value.text === "string" &&
    value.text.length <= MAX_TEXT &&
    (value.data === undefined || validResultData(value.data))
  );
}
function validCard(value: unknown, text: string): value is WokenCard {
  return (
    object(value) &&
    shortString(value.title, 200) &&
    shortString(value.how, 200) &&
    Number.isSafeInteger(value.start) &&
    (value.start as number) >= 0 &&
    (value.start as number) <= text.length
  );
}
function validWake(value: unknown): value is Wake {
  return (
    object(value) &&
    validSource(value.source) &&
    shortString(value.text, MAX_TEXT) &&
    validTime(value.due) &&
    (value.policy === "latest" || value.policy === "queue") &&
    (value.late === undefined || value.late === true) &&
    (value.word === undefined || value.word === "answer" || value.word === "raise") &&
    (value.quiet === undefined || value.quiet === true) &&
    (value.report === undefined || validReport(value.report)) &&
    (value.card === undefined || validCard(value.card, value.text as string))
  );
}
function validRecord(value: unknown): value is WakeRecord {
  return (
    object(value) &&
    validTime(value.due) &&
    validTime(value.at) &&
    OUTCOMES.includes(value.outcome as string) &&
    (value.reason === undefined || REASONS.includes(value.reason as string)) &&
    (value.manual === undefined || value.manual === true) &&
    (value.error === undefined || shortString(value.error, 100)) &&
    (value.session === undefined || (typeof value.session === "string" && UUID.test(value.session)))
  );
}
/** What can be read of a stored file; anything malformed is left out. */
function readState(value: unknown): State {
  if (!object(value) || value.version !== 1) throw new Error("unreadable");
  const records: State["records"] = {};
  for (const [id, list] of Object.entries(object(value.records) ? value.records : {}))
    if (Array.isArray(list)) records[id] = list.filter(validRecord).slice(0, MAX_RECORDS_KEPT);
  return { waiting: Array.isArray(value.waiting) ? value.waiting.filter(validWake) : [], records };
}

/**
 * Delivers wakes to sessions, whatever their source, by one set of rules: paused, nothing runs
 * unattended; while the session is busy or
 * archived, the wake waits (one per `latest` source, in order for `queue` ones); otherwise the
 * message is sent with a `WOKEN_ENTRY` before it. Messages that waited arrive together, as one
 * message and one run. Every outcome is recorded by source. Kept in each
 * session's `wakes.json`; waiting wakes are looked at by `drain`, which the runtime calls once a
 * minute and delivery calls after each run.
 */
export class Wakes {
  private readonly states = new Map<string, State>();
  /** Sources with a run in flight, as `sessionId/sourceId`. */
  private readonly running = new Set<string>();
  private draining?: Promise<void>;
  private closed = false;

  constructor(
    private readonly host: WakeHost,
    private readonly options: {
      now?: () => number;
      logger?: SafeLogger;
      /** A source's run ended (recorded), so the source can tidy up, such as a one-off schedule. */
      settled?: (sessionId: string, sourceId: string) => void;
      /** A wake has to wait for its session, which is working: a wait inside its turn may want it. */
      queued?: (sessionId: string, wake: Wake) => void;
    } = {},
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  private iso(): string {
    return new Date(this.now()).toISOString();
  }
  private get logger(): SafeLogger {
    return this.options.logger ?? silentLogger;
  }

  /** Reads every session's waiting wakes and records. */
  start(): void {
    for (const id of this.host.ids()) {
      const path = join(this.host.directory(id), "wakes.json");
      if (!existsSync(path)) continue;
      try {
        this.states.set(id, readState(JSON.parse(readFileSync(path, "utf8"))));
      } catch {
        this.logger.event("wake.unreadable", { sessionId: id, outcome: "failed", code: "storage" });
      }
    }
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    await this.draining?.catch(() => {});
  }
  paused(): boolean {
    return this.host.paused();
  }

  // ---- Delivery -------------------------------------------------------------------------------

  /** Runs the wake now if it can; otherwise it waits, or is recorded as missed. */
  async deliver(sessionId: string, wake: Wake): Promise<void> {
    if (this.closed) return;
    const paused = this.host.paused();
    if (paused && wake.policy === "latest") return this.note(sessionId, wake.source.id, { due: wake.due, outcome: "missed", reason: "paused" });
    // Wakes reach a session in order: behind any already waiting for it.
    const first = !paused && !this.state(sessionId).waiting.length;
    if (!first || !(await this.attempt(sessionId, [wake], false))) this.wait(sessionId, wake);
  }
  /** Run now, with the person watching: refused while the session is busy or archived. */
  async runNow(sessionId: string, wake: Wake): Promise<void> {
    if (this.archived(sessionId) || this.running.has(key(sessionId, wake.source.id)) || !this.host.free(sessionId)) throw new RuntimeError("busy");
    await this.fire(sessionId, [wake], { manual: true });
  }
  /** Looks at every waiting wake; overlapping calls share one pass. */
  drain(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return (this.draining ??= this.pass().finally(() => (this.draining = undefined)));
  }
  private async pass(): Promise<void> {
    for (const [sessionId, state] of [...this.states]) {
      if (!state.waiting.length) continue;
      if (this.host.paused()) {
        // Paused: a clock's waiting run is missed; a message keeps waiting for the pause to end.
        for (const wake of state.waiting.filter((w) => w.policy === "latest")) {
          this.remove(sessionId, wake);
          this.note(sessionId, wake.source.id, { due: wake.due, outcome: "missed", reason: "paused" });
        }
        continue;
      }
      while (state.waiting.length && !this.closed) {
        try {
          if (!(await this.attempt(sessionId, this.next(state.waiting), true))) break;
        } catch (error) {
          this.logger.event("wake.failure", { sessionId, outcome: "failed", code: runtimeError(error, "execution").code });
          break;
        }
      }
    }
  }
  /** What goes to the session next: a clock's run by itself, or the messages that wait together, as far as one message holds them. */
  private next(waiting: Wake[]): Wake[] {
    const first = waiting[0]!;
    if (first.policy === "latest") return [first];
    let size = first.text.length;
    const end = waiting.findIndex((wake, index) => index > 0 && (wake.policy !== "queue" || (size += wake.text.length) > MAX_TOGETHER));
    return waiting.slice(0, end < 0 ? waiting.length : end);
  }
  /** Sends the wakes if nothing stops it; `false` means they have to wait. */
  private async attempt(sessionId: string, wakes: Wake[], waited: boolean): Promise<boolean> {
    if (this.archived(sessionId) || wakes.some((wake) => this.running.has(key(sessionId, wake.source.id))) || !this.host.free(sessionId)) return false;
    return this.fire(sessionId, wakes, waited ? { reason: "busy" } : wakes[0]!.late ? { reason: "off" } : {});
  }
  /**
   * Settles each wake and sends what is left as one message. A wake it has dealt with no longer
   * waits; a run is recorded when it ends. `false`: the session turned busy meanwhile, and what was
   * not dealt with still waits.
   */
  private async fire(sessionId: string, wakes: Wake[], how: { reason?: "busy" | "off"; manual?: true }): Promise<boolean> {
    const at = this.iso();
    const record = (wake: Wake, result: Pick<WakeRecord, "outcome" | "error">) => this.note(sessionId, wake.source.id, { due: wake.due, at, ...result, ...how });
    const keys = (of: Wake[]) => new Set(of.map((wake) => key(sessionId, wake.source.id)));
    const flying = keys(wakes);
    for (const each of flying) this.running.add(each);
    const parts: { wake: Wake; text: string }[] = [];
    const handled: Wake[] = [];
    let completion: Promise<RunResult> | undefined;
    let failure: unknown;
    try {
      for (const wake of wakes) {
        const text = await this.host.settle(sessionId, wake);
        if (text === undefined) handled.push(wake);
        else parts.push({ wake, text });
      }
      if (parts.length) ({ completion } = this.host.send(sessionId, ...together(parts)));
    } catch (error) {
      failure = error;
    }
    // Only what was sent is still in flight.
    const sent = completion ? keys(parts.map((part) => part.wake)) : new Set<string>();
    for (const each of flying) if (!sent.has(each)) this.running.delete(each);
    for (const wake of handled) {
      this.remove(sessionId, wake);
      record(wake, { outcome: "handled" });
      this.options.settled?.(sessionId, wake.source.id);
    }
    if (failure !== undefined) {
      if (how.manual) throw failure;
      const code = runtimeError(failure, "execution").code;
      // Busy, or PiSpark is stopping: what was not dealt with waits.
      if (code === "busy" || code === "closed") return false;
      for (const wake of wakes.filter((each) => !handled.includes(each))) {
        this.remove(sessionId, wake);
        record(wake, { outcome: "failed", error: code });
      }
      return true;
    }
    if (!completion) return true;
    for (const { wake } of parts) this.remove(sessionId, wake);
    this.logger.event("wake.run", { sessionId, outcome: "completed" });
    void completion
      .then(
        (result) => ({
          outcome: result.outcome === "completed" ? ("ran" as const) : result.outcome === "cancelled" ? ("cancelled" as const) : ("failed" as const),
          ...(result.error ? { error: result.error } : {}),
        }),
        (error: unknown) => ({ outcome: "failed" as const, error: runtimeError(error, "execution").code }),
      )
      .then((result) => {
        // A source removed while its run was going has nothing left to record to.
        const kept = parts.filter(({ wake }) => this.running.has(key(sessionId, wake.source.id)));
        for (const each of sent) this.running.delete(each);
        for (const { wake } of kept) {
          record(wake, result);
          this.options.settled?.(sessionId, wake.source.id);
        }
        void this.drain();
      });
    return true;
  }
  private wait(sessionId: string, wake: Wake): void {
    const state = this.state(sessionId);
    const mine = state.waiting.filter((w) => w.source.id === wake.source.id);
    if (wake.policy === "latest" && mine.length) return;
    if (mine.length >= MAX_WAITING_PER_SOURCE) return this.note(sessionId, wake.source.id, { due: wake.due, outcome: "missed", reason: "full" });
    state.waiting.push(wake);
    this.save(sessionId);
    this.options.queued?.(sessionId, wake);
  }
  private remove(sessionId: string, wake: Wake): void {
    const state = this.state(sessionId);
    state.waiting = state.waiting.filter((w) => w !== wake);
    this.save(sessionId);
  }
  private archived(sessionId: string): boolean {
    return !!this.host.sessions().find((s) => s.id === sessionId)?.archived;
  }

  // ---- What sources read and change -----------------------------------------------------------

  /** Records an outcome the source decided itself, such as a run missed while PiSpark was off. */
  note(sessionId: string, sourceId: string, record: Omit<WakeRecord, "at"> & { at?: string }): void {
    const state = this.state(sessionId);
    state.records[sourceId] = [{ ...record, at: record.at ?? this.iso() }, ...(state.records[sourceId] ?? [])].slice(0, MAX_RECORDS_KEPT);
    this.save(sessionId);
  }
  records(sessionId: string, sourceId: string): WakeRecord[] {
    return structuredClone(this.states.get(sessionId)?.records[sourceId] ?? []);
  }
  waiting(sessionId: string, sourceId?: string): boolean {
    return !!this.states.get(sessionId)?.waiting.some((w) => sourceId === undefined || w.source.id === sourceId);
  }
  /** Whether the source has a wake waiting or running. */
  active(sessionId: string, sourceId: string): boolean {
    return this.waiting(sessionId, sourceId) || this.running.has(key(sessionId, sourceId));
  }
  /**
   * Takes the waiting wakes that `which` picks: the session has what they say already (it waited
   * for them, looked, or answered), so they are not sent. Each is recorded as handled.
   */
  take(sessionId: string, which: (wake: Wake) => boolean): Wake[] {
    const state = this.states.get(sessionId);
    const taken = state?.waiting.filter(which) ?? [];
    if (!state || !taken.length) return [];
    state.waiting = state.waiting.filter((w) => !taken.includes(w));
    for (const wake of taken) this.note(sessionId, wake.source.id, { due: wake.due, outcome: "handled" });
    return taken;
  }
  /** Drops the source's waiting wakes, such as when a schedule is switched off. */
  cancel(sessionId: string, sourceId: string): void {
    const state = this.states.get(sessionId);
    if (!state?.waiting.some((w) => w.source.id === sourceId)) return;
    state.waiting = state.waiting.filter((w) => w.source.id !== sourceId);
    this.save(sessionId);
  }
  /** The source is gone: its waiting wakes and records go with it. */
  forgetSource(sessionId: string, sourceId: string): void {
    const state = this.states.get(sessionId);
    this.running.delete(key(sessionId, sourceId));
    if (!state) return;
    state.waiting = state.waiting.filter((w) => w.source.id !== sourceId);
    delete state.records[sourceId];
    this.save(sessionId);
  }
  /** The session was deleted: its wakes went with its folder. */
  forget(sessionId: string): void {
    this.states.delete(sessionId);
    for (const running of [...this.running]) if (running.startsWith(`${sessionId}/`)) this.running.delete(running);
  }

  // ---- Storage --------------------------------------------------------------------------------

  private state(sessionId: string): State {
    let state = this.states.get(sessionId);
    if (!state) this.states.set(sessionId, (state = { waiting: [], records: {} }));
    return state;
  }
  private save(sessionId: string): void {
    const directory = this.host.directory(sessionId);
    // A deleted session's folder is not brought back.
    if (!existsSync(directory)) return;
    try {
      writeAtomic(join(directory, "wakes.json"), JSON.stringify({ version: 1, ...this.state(sessionId) }, null, 2) + "\n");
    } catch {
      this.logger.event("wake.failure", { sessionId, outcome: "failed", code: "storage" });
    }
  }
}
