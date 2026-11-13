import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_RECORDS_KEPT,
  MAX_WAITING_PER_SOURCE,
  type WakeRecord,
  type WakeSource,
  type WokenDetails,
} from "../../contract/wake-protocol.js";
import { silentLogger, type SafeLogger } from "../logger.js";
import { writeAtomic } from "../personas/store.js";
import { RuntimeError, runtimeError } from "./errors.js";
import type { RunResult } from "./chat.js";

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
}

/** What delivery needs from the runtime that holds the sessions. */
export interface WakeHost {
  /** Every session there is, and whether it is archived. */
  sessions(): { id: string; archived: boolean }[];
  /** The session folders there are, read without loading anything (at start). */
  ids(): string[];
  /** The session's folder, where its `wakes.json` lives beside `chat.json`. */
  directory(sessionId: string): string;
  /** Whether a message could be sent now: the session is not loaded, or loaded with nothing going on. */
  free(sessionId: string): boolean;
  /** Loads the session if needed and sends the message, which then runs (or waits for a run slot). Throws `busy`. */
  run(sessionId: string, text: string, details: WokenDetails): Promise<{ completion: Promise<RunResult> }>;
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
const OUTCOMES = ["ran", "failed", "cancelled", "missed"];
const REASONS = ["busy", "off", "paused", "full"];

/** A source in a session, for the runs in flight. */
const key = (sessionId: string, sourceId: string) => `${sessionId}/${sourceId}`;
const time = (value: string) => new Date(value).getTime();
const validTime = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && !Number.isNaN(time(value));
const shortString = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function validSource(value: unknown): value is WakeSource {
  return object(value) && (value.kind === "schedule" || value.kind === "session") && shortString(value.id, 100) && shortString(value.label, 200);
}
function validWake(value: unknown): value is Wake {
  return (
    object(value) &&
    validSource(value.source) &&
    shortString(value.text, MAX_TEXT) &&
    validTime(value.due) &&
    (value.policy === "latest" || value.policy === "queue") &&
    (value.late === undefined || value.late === true)
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
    (value.error === undefined || shortString(value.error, 100))
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
 * message is sent with a `WOKEN_ENTRY` before it. Every outcome is recorded by source. Kept in each
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
    if (!first || !(await this.attempt(sessionId, wake, false))) this.wait(sessionId, wake);
  }
  /** Run now, with the person watching: refused while the session is busy or archived. */
  async runNow(sessionId: string, wake: Wake): Promise<void> {
    if (this.archived(sessionId) || this.running.has(key(sessionId, wake.source.id)) || !this.host.free(sessionId)) throw new RuntimeError("busy");
    await this.fire(sessionId, wake, { manual: true });
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
        const wake = state.waiting[0]!;
        try {
          if (!(await this.attempt(sessionId, wake, true))) break;
        } catch (error) {
          this.logger.event("wake.failure", { sessionId, outcome: "failed", code: runtimeError(error, "execution").code });
          break;
        }
        this.remove(sessionId, wake);
      }
    }
  }
  /** Sends the wake if nothing stops it; `false` means it has to wait. */
  private async attempt(sessionId: string, wake: Wake, waited: boolean): Promise<boolean> {
    if (this.archived(sessionId) || this.running.has(key(sessionId, wake.source.id)) || !this.host.free(sessionId)) return false;
    return this.fire(sessionId, wake, waited ? { reason: "busy" } : wake.late ? { reason: "off" } : {});
  }
  /** Sends the message. The run is recorded when it ends. `false`: the session turned busy meanwhile. */
  private async fire(sessionId: string, wake: Wake, how: { reason?: "busy" | "off"; manual?: true }): Promise<boolean> {
    const running = key(sessionId, wake.source.id);
    const at = this.iso();
    this.running.add(running);
    let completion: Promise<RunResult>;
    try {
      ({ completion } = await this.host.run(sessionId, wake.text, { source: wake.source, due: wake.due }));
    } catch (error) {
      this.running.delete(running);
      if (how.manual) throw error;
      const code = runtimeError(error, "execution").code;
      // Busy, or PiSpark is stopping: it waits.
      if (code === "busy" || code === "closed") return false;
      this.note(sessionId, wake.source.id, { due: wake.due, at, outcome: "failed", error: code });
      return true;
    }
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
        if (!this.running.delete(running)) return;
        this.note(sessionId, wake.source.id, { due: wake.due, at, ...result, ...how });
        this.options.settled?.(sessionId, wake.source.id);
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
  waiting(sessionId: string, sourceId: string): boolean {
    return !!this.states.get(sessionId)?.waiting.some((w) => w.source.id === sourceId);
  }
  /** Whether the source has a wake waiting or running. */
  active(sessionId: string, sourceId: string): boolean {
    return this.waiting(sessionId, sourceId) || this.running.has(key(sessionId, sourceId));
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
