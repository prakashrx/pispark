import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { nextRun, parseCron } from "../../contract/cron.js";
import {
  DEFAULT_DAILY_LIMIT,
  MAX_RUNS_KEPT,
  MAX_SCHEDULES_PER_SESSION,
  type Schedule,
  type ScheduleInput,
  type ScheduleRun,
} from "../../contract/schedule-protocol.js";
import { silentLogger, type SafeLogger } from "../logger.js";
import { writeAtomic } from "../personas/store.js";
import { RuntimeError, runtimeError } from "./errors.js";
import type { RunResult } from "./chat.js";

/** What a scheduled run puts in the session before its prompt (`SCHEDULED_ENTRY`). */
export interface ScheduledMarker {
  schedule: string;
  due: string;
  cron?: string;
  at?: string;
}
/** What the scheduler needs from the runtime that holds the sessions. */
export interface ScheduleHost {
  /** Every session there is, and whether it is archived. */
  sessions(): { id: string; archived: boolean }[];
  /** The session folders there are, read without loading anything (at start). */
  ids(): string[];
  /** The session's folder, where its `schedules.json` lives beside `chat.json`. */
  directory(sessionId: string): string;
  /** Whether a prompt could be sent now: the session is not loaded, or loaded with nothing going on. */
  free(sessionId: string): boolean;
  /** Loads the session if needed and sends the prompt, which then runs (or waits for a run slot). Throws `busy`. */
  run(sessionId: string, text: string, marker: ScheduledMarker): Promise<{ completion: Promise<RunResult> }>;
  /** Pause all, from the host's settings. */
  paused(): boolean;
}

/** One schedule as `schedules.json` keeps it. */
interface Stored {
  id: string;
  cron?: string;
  at?: string;
  prompt: string;
  on: boolean;
  limit: number;
  createdAt: string;
  by: "person" | "agent";
  runs: ScheduleRun[];
  /** The last due time that was dealt with (run, waited for, missed or passed over). */
  lastDue: string;
  /** A due run waiting for the session to be free. */
  waiting?: string;
}

const MAX_PROMPT = 8 * 1024;
const MAX_LIMIT = 1440;
const DAY = 86_400_000;
/** A run missed while PiSpark was off is still sent if it was due within this long. */
const CATCH_UP = DAY;

const time = (value: string) => new Date(value).getTime();
const validTime = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && !Number.isNaN(time(value));
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function validStored(value: unknown): value is Stored {
  const s = value as Stored;
  return (
    !!s &&
    typeof s === "object" &&
    typeof s.id === "string" &&
    /^[a-f0-9-]{36}$/.test(s.id) &&
    (s.cron === undefined) !== (s.at === undefined) &&
    (s.cron === undefined || !!parseCron(s.cron)) &&
    (s.at === undefined || validTime(s.at)) &&
    typeof s.prompt === "string" &&
    !!s.prompt.trim() &&
    s.prompt.length <= MAX_PROMPT &&
    typeof s.on === "boolean" &&
    Number.isSafeInteger(s.limit) &&
    s.limit >= 1 &&
    s.limit <= MAX_LIMIT &&
    validTime(s.createdAt) &&
    (s.by === "person" || s.by === "agent") &&
    Array.isArray(s.runs) &&
    validTime(s.lastDue) &&
    (s.waiting === undefined || validTime(s.waiting))
  );
}

/**
 * The schedules of every session: kept in each session's folder, indexed in memory, checked once a
 * minute. A due schedule sends its prompt to its session; while the session is busy one run waits for
 * it; a run missed while PiSpark was off is sent once if it was due within a day. Each schedule keeps
 * its last ten runs. No catch-up backlog, nothing for archived sessions, nothing while paused.
 */
export class Scheduler {
  private readonly index = new Map<string, Stored[]>();
  private readonly running = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private readonly startedAt: number;
  private closed = false;

  constructor(
    private readonly host: ScheduleHost,
    private readonly options: { tickMs?: number; now?: () => number; logger?: SafeLogger } = {},
  ) {
    this.startedAt = this.now();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  private get logger(): SafeLogger {
    return this.options.logger ?? silentLogger;
  }

  /** Reads every session's schedules and starts checking them (unless `tickMs` is 0). */
  start(): void {
    for (const id of this.host.ids()) {
      const path = join(this.host.directory(id), "schedules.json");
      if (!existsSync(path)) continue;
      try {
        const file = JSON.parse(readFileSync(path, "utf8")) as { version?: number; schedules?: unknown[] };
        if (file.version !== 1 || !Array.isArray(file.schedules)) throw new Error();
        const schedules = file.schedules.filter(validStored).slice(0, MAX_SCHEDULES_PER_SESSION);
        if (schedules.length) this.index.set(id, schedules);
      } catch {
        this.logger.event("schedule.unreadable", { sessionId: id, outcome: "failed", code: "storage" });
      }
    }
    const tickMs = this.options.tickMs ?? 60_000;
    if (tickMs > 0) {
      this.timer = setInterval(() => void this.tick(), tickMs);
      this.timer.unref();
      // Runs missed while PiSpark was off are looked at soon after it starts.
      setTimeout(() => void this.tick(), Math.min(tickMs, 5000)).unref();
    }
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.ticking?.catch(() => {});
  }

  // ---- What clients read and change -----------------------------------------------------------

  list(): Schedule[] {
    const archived = new Set(this.host.sessions().filter((s) => s.archived).map((s) => s.id));
    return [...this.index].flatMap(([sessionId, schedules]) => schedules.map((s) => this.view(sessionId, s, archived.has(sessionId))));
  }
  private view(sessionId: string, s: Stored, archived: boolean): Schedule {
    const next = s.on && !archived && !this.host.paused() ? this.next(s) : undefined;
    const { lastDue: _lastDue, waiting, ...rest } = s;
    return {
      ...structuredClone(rest),
      sessionId,
      ...(next ? { next } : {}),
      ...(waiting && !archived ? { waiting: true as const } : {}),
      ...(archived ? { held: "archived" as const } : {}),
    };
  }
  private next(s: Stored): string | undefined {
    if (s.at !== undefined) return time(s.at) > time(s.lastDue) ? s.at : undefined;
    const after = new Date(Math.max(this.now(), time(s.lastDue)));
    return nextRun(parseCron(s.cron!)!, after)?.toISOString();
  }
  private find(id: string): { sessionId: string; schedule: Stored } {
    if (typeof id !== "string") throw new RuntimeError("invalid-input");
    for (const [sessionId, schedules] of this.index) {
      const schedule = schedules.find((s) => s.id === id);
      if (schedule) return { sessionId, schedule };
    }
    throw new RuntimeError("not-found");
  }
  /** Validates when, prompt, on and limit; `base` is the schedule being changed. */
  private validInput(input: ScheduleInput, base?: Stored): Pick<Stored, "cron" | "at" | "prompt" | "on" | "limit"> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new RuntimeError("invalid-input");
    const allowed = ["cron", "at", "prompt", "on", "limit", ...(base ? [] : ["sessionId"])];
    if (Object.keys(input).some((key) => !allowed.includes(key))) throw new RuntimeError("invalid-input");
    const whenGiven = input.cron !== undefined || input.at !== undefined;
    if (input.cron !== undefined && input.at !== undefined) throw new RuntimeError("invalid-input");
    if (!base && !whenGiven) throw new RuntimeError("invalid-input");
    const cron = input.cron !== undefined ? input.cron.trim().replace(/\s+/g, " ") : whenGiven ? undefined : base?.cron;
    const at = input.at !== undefined ? input.at : whenGiven ? undefined : base?.at;
    if (cron !== undefined && (!parseCron(cron) || !nextRun(parseCron(cron)!, new Date(this.now())))) throw new RuntimeError("invalid-input");
    if (input.at !== undefined) {
      if (!validTime(at) || time(at) <= this.now() || time(at) > this.now() + 366 * DAY) throw new RuntimeError("invalid-input");
    }
    const prompt = input.prompt ?? base?.prompt;
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT) throw new RuntimeError("invalid-input");
    const on = input.on ?? base?.on ?? true;
    const limit = input.limit ?? base?.limit ?? DEFAULT_DAILY_LIMIT;
    if (typeof on !== "boolean" || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new RuntimeError("invalid-input");
    return { ...(cron !== undefined ? { cron } : { at: new Date(at!).toISOString() }), prompt, on, limit };
  }
  add(sessionId: string, input: ScheduleInput, by: "person" | "agent"): Schedule {
    const session = this.host.sessions().find((s) => s.id === sessionId);
    if (!session) throw new RuntimeError("not-found");
    if (session.archived) throw new RuntimeError("busy");
    const valid = this.validInput(input);
    const schedules = this.index.get(sessionId) ?? [];
    if (schedules.length >= MAX_SCHEDULES_PER_SESSION) throw new RuntimeError("limit");
    const now = new Date(this.now()).toISOString();
    const schedule: Stored = { id: randomUUID(), ...valid, createdAt: now, by, runs: [], lastDue: now };
    this.save(sessionId, [...schedules, schedule]);
    this.logger.event("schedule.add", { sessionId, outcome: "completed" });
    return this.view(sessionId, schedule, false);
  }
  /** Changes some fields. A new time, or switching on, starts counting from now: nothing is caught up. */
  update(id: string, input: ScheduleInput): Schedule {
    const { sessionId, schedule } = this.find(id);
    const valid = this.validInput(input, schedule);
    const restart = input.cron !== undefined || input.at !== undefined || (valid.on && !schedule.on);
    const { cron: _cron, at: _at, ...kept } = schedule;
    const changed: Stored = {
      ...kept,
      ...valid,
      ...(restart ? { lastDue: new Date(this.now()).toISOString() } : {}),
    };
    if (restart || !valid.on) delete changed.waiting;
    this.replace(sessionId, changed);
    return this.view(sessionId, changed, this.archived(sessionId));
  }
  remove(id: string): void {
    const { sessionId } = this.find(id);
    this.drop(sessionId, id);
  }
  /** The session was deleted: its schedules went with its folder. */
  forget(sessionId: string): void {
    this.index.delete(sessionId);
  }
  /** Run now, with the person watching: refused while the session is busy or archived. */
  async runNow(id: string): Promise<void> {
    const { sessionId, schedule } = this.find(id);
    if (this.archived(sessionId)) throw new RuntimeError("busy");
    if (this.running.has(id) || !this.host.free(sessionId)) throw new RuntimeError("busy");
    await this.fire(sessionId, schedule, new Date(this.now()).toISOString(), { manual: true });
  }
  /** The schedules of one session, for its agent. */
  of(sessionId: string): Schedule[] {
    return (this.index.get(sessionId) ?? []).map((s) => this.view(sessionId, s, false));
  }

  // ---- Checking -------------------------------------------------------------------------------

  /** Looks at every schedule once; overlapping calls share one pass. */
  tick(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return (this.ticking ??= this.check().finally(() => (this.ticking = undefined)));
  }
  private async check(): Promise<void> {
    const now = this.now();
    const sessions = new Map(this.host.sessions().map((s) => [s.id, s.archived]));
    for (const [sessionId, schedules] of [...this.index]) {
      if (!sessions.has(sessionId)) continue;
      for (const s of [...schedules]) {
        if (this.closed) return;
        try {
          await this.consider(sessionId, s, now, sessions.get(sessionId)!);
        } catch (error) {
          this.logger.event("schedule.failure", { sessionId, outcome: "failed", code: runtimeError(error, "execution").code });
        }
      }
    }
  }
  /** The latest due time after the last one dealt with, up to now. */
  private due(s: Stored, now: number): string | undefined {
    if (s.at !== undefined) return time(s.at) > time(s.lastDue) && time(s.at) <= now ? s.at : undefined;
    const cron = parseCron(s.cron!)!;
    let latest: Date | undefined;
    let cursor = new Date(time(s.lastDue));
    // Bounded: a schedule every minute that was off for days still takes at most this many steps.
    for (let steps = 0; steps < 10_000; steps++) {
      const next = nextRun(cron, cursor);
      if (!next || next.getTime() > now) break;
      latest = cursor = next;
    }
    if (!latest) return undefined;
    // Past the bound, jump: only the latest due time matters.
    if (nextRun(cron, latest) && nextRun(cron, latest)!.getTime() <= now) return new Date(now - (now % 60_000)).toISOString();
    return latest.toISOString();
  }
  private async consider(sessionId: string, s: Stored, now: number, archived: boolean): Promise<void> {
    if (this.running.has(s.id)) return;
    const due = this.due(s, now);
    // Archived or switched off: time passes without catching up later.
    if (archived || !s.on) {
      const { waiting, ...rest } = s;
      if (due || waiting) this.replace(sessionId, { ...rest, lastDue: due ?? s.lastDue });
      return;
    }
    if (s.waiting) {
      const waited = s.waiting;
      if (due) this.replace(sessionId, (s = { ...s, lastDue: due }));
      if (this.host.paused() || !this.host.free(sessionId)) return;
      await this.fire(sessionId, s, waited, { reason: "busy" });
      return;
    }
    if (!due) return;
    const dealt = { ...s, lastDue: due };
    if (this.host.paused()) return this.finish(sessionId, dealt, { due, outcome: "missed", reason: "paused" });
    if (now - time(due) > CATCH_UP) return this.finish(sessionId, dealt, { due, outcome: "missed", reason: "off" });
    if (this.ranToday(s, now) >= s.limit) return this.finish(sessionId, dealt, { due, outcome: "limit" });
    if (!this.host.free(sessionId)) {
      this.replace(sessionId, { ...dealt, waiting: due });
      return;
    }
    await this.fire(sessionId, dealt, due, time(due) < this.startedAt ? { reason: "off" } : {});
  }
  private ranToday(s: Stored, now: number): number {
    const today = new Date(now);
    return s.runs.filter((run) => ["ran", "failed", "cancelled"].includes(run.outcome) && sameDay(new Date(run.at), today)).length;
  }
  /**
   * Sends the prompt. The run is recorded when it ends; a one-off schedule goes once its run is done.
   * A session that turned busy meanwhile makes the run wait (Run now is refused instead).
   */
  private async fire(sessionId: string, s: Stored, due: string, how: { reason?: "busy" | "off"; manual?: true }): Promise<void> {
    const { waiting: _waiting, ...current } = s;
    this.replace(sessionId, current);
    this.running.add(s.id);
    const at = new Date(this.now()).toISOString();
    let completion: Promise<RunResult>;
    try {
      ({ completion } = await this.host.run(sessionId, s.prompt, {
        schedule: s.id,
        due,
        ...(s.cron !== undefined ? { cron: s.cron } : { at: s.at }),
      }));
    } catch (error) {
      this.running.delete(s.id);
      const code = runtimeError(error, "execution").code;
      if (code === "busy" && !how.manual) {
        this.replace(sessionId, { ...current, waiting: due });
        return;
      }
      if (how.manual) throw error;
      this.finish(sessionId, current, { due, at, outcome: "failed", error: code });
      return;
    }
    this.logger.event("schedule.run", { sessionId, outcome: "completed" });
    void completion
      .then(
        (result) => ({
          outcome: result.outcome === "completed" ? ("ran" as const) : result.outcome === "cancelled" ? ("cancelled" as const) : ("failed" as const),
          ...(result.error ? { error: result.error } : {}),
        }),
        (error: unknown) => ({ outcome: "failed" as const, error: runtimeError(error, "execution").code }),
      )
      .then((result) => {
        this.running.delete(s.id);
        const latest = this.index.get(sessionId)?.find((x) => x.id === s.id);
        if (!latest) return;
        this.finish(sessionId, latest, { due, at, ...result, ...(how.reason ? { reason: how.reason } : {}), ...(how.manual ? { manual: true as const } : {}) }, !how.manual);
      });
  }
  /** Records a run; a one-off schedule whose time has been dealt with is removed. */
  private finish(sessionId: string, s: Stored, run: Omit<ScheduleRun, "at"> & { at?: string }, done = true): void {
    const record: ScheduleRun = { ...run, at: run.at ?? new Date(this.now()).toISOString() };
    if (s.at !== undefined && done && time(s.lastDue) >= time(s.at)) {
      this.drop(sessionId, s.id);
      return;
    }
    this.replace(sessionId, { ...s, runs: [record, ...s.runs].slice(0, MAX_RUNS_KEPT) });
  }

  // ---- Storage --------------------------------------------------------------------------------

  private archived(sessionId: string): boolean {
    return !!this.host.sessions().find((s) => s.id === sessionId)?.archived;
  }
  private replace(sessionId: string, schedule: Stored): void {
    const schedules = this.index.get(sessionId);
    if (!schedules) return;
    this.save(
      sessionId,
      schedules.map((s) => (s.id === schedule.id ? schedule : s)),
    );
  }
  private drop(sessionId: string, id: string): void {
    this.save(
      sessionId,
      (this.index.get(sessionId) ?? []).filter((s) => s.id !== id),
    );
  }
  private save(sessionId: string, schedules: Stored[]): void {
    const directory = this.host.directory(sessionId);
    if (!existsSync(directory)) {
      this.index.delete(sessionId);
      throw new RuntimeError("not-found");
    }
    try {
      writeAtomic(join(directory, "schedules.json"), JSON.stringify({ version: 1, schedules }, null, 2) + "\n");
    } catch {
      throw new RuntimeError("storage");
    }
    if (schedules.length) this.index.set(sessionId, schedules);
    else this.index.delete(sessionId);
  }
}
