import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describeSchedule, nextRun, parseCron, shortDate } from "../../contract/cron.js";
import { DEFAULT_DAILY_LIMIT, MAX_SCHEDULES_PER_SESSION, type Schedule, type ScheduleInput } from "../../contract/schedule-protocol.js";
import { silentLogger, type SafeLogger } from "../logger.js";
import { writeAtomic } from "../personas/store.js";
import { RuntimeError, runtimeError } from "./errors.js";
import type { Wake, Wakes } from "./wakes.js";

/** What the clock needs from the runtime that holds the sessions. */
export interface ClockHost {
  /** Every session there is, and whether it is archived. */
  sessions(): { id: string; archived: boolean }[];
  /** The session folders there are, read without loading anything (at start). */
  ids(): string[];
  /** The session's folder, where its `schedules.json` lives beside `chat.json`. */
  directory(sessionId: string): string;
}

/** One schedule as `schedules.json` keeps it. Its runs are the wakes' records. */
interface Stored {
  id: string;
  cron?: string;
  at?: string;
  prompt: string;
  on: boolean;
  limit: number;
  createdAt: string;
  by: "person" | "agent";
  /** The last due time that was dealt with (delivered, missed or passed over). */
  lastDue: string;
}

const MAX_PROMPT = 8 * 1024;
const MAX_LIMIT = 1440;
const DAY = 86_400_000;
/** A run missed while PiSpark was off is still sent if it was due within this long. */
const CATCH_UP = DAY;

const time = (value: string) => new Date(value).getTime();
const validTime = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && !Number.isNaN(time(value));

/** A stored schedule, keeping only what is known of it. */
function readStored(value: unknown): Stored | undefined {
  const s = value as Stored;
  const valid =
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
    validTime(s.lastDue);
  if (!valid) return undefined;
  const { id, cron, at, prompt, on, limit, createdAt, by, lastDue } = s;
  return { id, ...(cron !== undefined ? { cron } : { at }), prompt, on, limit, createdAt, by, lastDue };
}

/**
 * The clock: every session's schedules, kept in each session's folder and checked once a minute. A
 * schedule decides only when it is due and what it says; delivery (waiting while busy, the daily
 * limit, Pause all, records) is the wakes'. Only the latest due time counts; a run missed while
 * PiSpark was off is sent once if it was due within a day; archived sessions' schedules pass their
 * times without catching up.
 */
export class Schedules {
  private readonly index = new Map<string, Stored[]>();
  private readonly startedAt: number;
  private closed = false;

  constructor(
    private readonly host: ClockHost,
    private readonly wakes: Wakes,
    private readonly options: { now?: () => number; logger?: SafeLogger } = {},
  ) {
    this.startedAt = this.now();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  private get logger(): SafeLogger {
    return this.options.logger ?? silentLogger;
  }

  /** Reads every session's schedules. */
  start(): void {
    for (const id of this.host.ids()) {
      const path = join(this.host.directory(id), "schedules.json");
      if (!existsSync(path)) continue;
      try {
        const file = JSON.parse(readFileSync(path, "utf8")) as { version?: number; schedules?: unknown[] };
        if (file.version !== 1 || !Array.isArray(file.schedules)) throw new Error();
        const schedules = file.schedules.flatMap((s) => readStored(s) ?? []).slice(0, MAX_SCHEDULES_PER_SESSION);
        if (schedules.length) this.index.set(id, schedules);
      } catch {
        this.logger.event("schedule.unreadable", { sessionId: id, outcome: "failed", code: "storage" });
      }
    }
  }
  shutdown(): void {
    this.closed = true;
  }

  // ---- What clients read and change -----------------------------------------------------------

  list(): Schedule[] {
    const archived = new Set(this.host.sessions().filter((s) => s.archived).map((s) => s.id));
    return [...this.index].flatMap(([sessionId, schedules]) => schedules.map((s) => this.view(sessionId, s, archived.has(sessionId))));
  }
  private view(sessionId: string, s: Stored, archived: boolean): Schedule {
    const next = s.on && !archived && !this.wakes.paused() ? this.next(s) : undefined;
    const { lastDue: _lastDue, ...rest } = s;
    return {
      ...structuredClone(rest),
      sessionId,
      runs: this.wakes.records(sessionId, s.id),
      ...(next ? { next } : {}),
      ...(this.wakes.waiting(sessionId, s.id) && !archived ? { waiting: true as const } : {}),
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
    const schedule: Stored = { id: randomUUID(), ...valid, createdAt: now, by, lastDue: now };
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
    const changed: Stored = { ...kept, ...valid, ...(restart ? { lastDue: new Date(this.now()).toISOString() } : {}) };
    if (restart || !valid.on) this.wakes.cancel(sessionId, id);
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
    await this.wakes.runNow(sessionId, this.wake(schedule, new Date(this.now()).toISOString()));
  }
  /** The schedules of one session, for its agent. */
  of(sessionId: string): Schedule[] {
    return (this.index.get(sessionId) ?? []).map((s) => this.view(sessionId, s, false));
  }
  /** A schedule's run ended: a one-off whose time has been dealt with goes. */
  settled(sessionId: string, id: string): void {
    const schedule = this.index.get(sessionId)?.find((s) => s.id === id);
    if (schedule) this.tidy(sessionId, schedule);
  }

  // ---- Checking -------------------------------------------------------------------------------

  /** Looks at every schedule once, delivering what is due. */
  async check(): Promise<void> {
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
    const due = this.due(s, now);
    if (due) this.replace(sessionId, (s = { ...s, lastDue: due }));
    // Archived or switched off: time passes without catching up later.
    if (archived || !s.on) this.wakes.cancel(sessionId, s.id);
    else if (due && now - time(due) > CATCH_UP) this.wakes.note(sessionId, s.id, { due, outcome: "missed", reason: "off" });
    else if (due) await this.wakes.deliver(sessionId, this.wake(s, due, time(due) < this.startedAt));
    this.tidy(sessionId, s);
  }
  private wake(s: Stored, due: string, late = false): Wake {
    const now = new Date(this.now());
    // A one-off already says its day; a repeating one says which of its days this was.
    const label = [describeSchedule(s, now), s.cron !== undefined ? shortDate(new Date(due), now).split(",")[0] : ""].filter(Boolean).join(" · ");
    return {
      source: { kind: "schedule", id: s.id, label },
      text: s.prompt,
      due,
      policy: "latest",
      limit: s.limit,
      ...(late ? { late: true as const } : {}),
    };
  }
  /** A one-off whose time has been dealt with goes once nothing of it is waiting or running. */
  private tidy(sessionId: string, s: Stored): void {
    if (s.at !== undefined && time(s.lastDue) >= time(s.at) && !this.wakes.active(sessionId, s.id)) this.drop(sessionId, s.id);
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
    const schedules = this.index.get(sessionId) ?? [];
    if (!schedules.some((s) => s.id === id)) return;
    this.save(
      sessionId,
      schedules.filter((s) => s.id !== id),
    );
    this.wakes.forgetSource(sessionId, id);
  }
  private save(sessionId: string, schedules: Stored[]): void {
    try {
      writeAtomic(join(this.host.directory(sessionId), "schedules.json"), JSON.stringify({ version: 1, schedules }, null, 2) + "\n");
    } catch {
      throw new RuntimeError("storage");
    }
    if (schedules.length) this.index.set(sessionId, schedules);
    else this.index.delete(sessionId);
  }
}
