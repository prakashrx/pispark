import { describeSchedule, nextRun, parseCron, shortDate } from "../../contract/cron.js";
import type { RoutineDefinition } from "../../contract/persona-protocol.js";
import type { Routine, RoutineRun } from "../../contract/schedule-protocol.js";
import { silentLogger, type SafeLogger } from "../logger.js";
import { RuntimeError, runtimeError } from "./errors.js";
import { CATCH_UP_MS, latestDue } from "./schedules.js";
import type { Wakes } from "./wakes.js";

/** What the routines' clock needs from the runtime. */
export interface RoutineHost {
  /** Every persona that offers routines, each with whether it is switched on. */
  personas(): { id: string; name: string; home?: string; routines: (RoutineDefinition & { on: boolean })[] }[];
  /** The sessions a routine's runs made (`schedule.id` is the routine's key), newest first. */
  runs(key: string): RoutineRun[];
  /** A run: a new session of the persona, named for the run. Returns its id. */
  spawn(persona: string, run: { title: string; schedule: { id: string; due: string } }): Promise<string>;
}

/** A routine's key, as its runs' sessions and wakes know it. */
export const routineKey = (persona: string, id: string) => `${persona}/${id}`;

/**
 * The clock of the routines personas offer (VISION: unattended work is off unless a person turns it
 * on for a persona). Each run is a new session of the persona, sent the routine's prompt as a wake.
 * Nothing is stored here: when a routine last ran is read from its newest run's session; one that
 * never ran, or was just switched on, counts from then, without catching up. Paused, runs are missed.
 */
export class Routines {
  /** The last due time dealt with, per routine that is switched on. */
  private readonly lastDue = new Map<string, string>();
  private readonly startedAt: number;
  /** The first check is done: a routine seen switched on after it was switched on then. */
  private checked = false;

  constructor(
    private readonly host: RoutineHost,
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

  list(): Routine[] {
    return this.host.personas().flatMap((persona) =>
      persona.routines.map((routine) => {
        const key = routineKey(persona.id, routine.id);
        const next = routine.on && !this.wakes.paused() ? nextRun(parseCron(routine.cron)!, new Date(Math.max(this.now(), new Date(this.since(key)).getTime()))) : undefined;
        const { on, ...definition } = routine;
        return {
          ...definition,
          persona: { id: persona.id, name: persona.name, ...(persona.home ? { home: persona.home } : {}) },
          on,
          ...(next ? { next: next.toISOString() } : {}),
          runs: this.host.runs(key).slice(0, 10),
        };
      }),
    );
  }
  /**
   * Switched on now (from the Routines panel): it counts from now. A switch made elsewhere, such as
   * in the persona editor, is seen at the next check and counts from then.
   */
  switchedOn(persona: string, id: string): void {
    this.lastDue.set(routineKey(persona, id), new Date(this.now()).toISOString());
  }
  /** Run now, with the person watching, switched on or not. */
  async runNow(persona: string, id: string): Promise<void> {
    const routine = this.host.personas().find((p) => p.id === persona)?.routines.find((r) => r.id === id);
    if (!routine) throw new RuntimeError("not-found");
    await this.run(persona, routine, new Date(this.now()).toISOString(), true);
  }

  /** Looks at every routine that is switched on, starting what is due. */
  async check(): Promise<void> {
    const now = this.now();
    const on = new Set<string>();
    for (const persona of this.host.personas())
      for (const routine of persona.routines.filter((r) => r.on)) {
        const key = routineKey(persona.id, routine.id);
        on.add(key);
        if (!this.lastDue.has(key)) this.lastDue.set(key, this.since(key));
        const due = latestDue(routine.cron, this.lastDue.get(key)!, now);
        if (!due) continue;
        this.lastDue.set(key, due);
        if (now - new Date(due).getTime() > CATCH_UP_MS || this.wakes.paused()) continue;
        try {
          await this.run(persona.id, routine, due, false);
        } catch (error) {
          this.logger.event("schedule.failure", { personaId: persona.id, outcome: "failed", code: runtimeError(error, "execution").code });
        }
      }
    // Switched off: switched on again later, it counts from then.
    for (const key of [...this.lastDue.keys()]) if (!on.has(key)) this.lastDue.delete(key);
    this.checked = true;
  }
  /**
   * Where a routine counts from. At start: its newest run (so one missed while PiSpark was off is
   * caught up within a day), or the start if it never ran. Switched on later: now.
   */
  private since(key: string): string {
    const known = this.lastDue.get(key);
    if (known) return known;
    if (this.checked) return new Date(this.now()).toISOString();
    return this.host.runs(key)[0]?.due ?? new Date(this.startedAt).toISOString();
  }
  private async run(persona: string, routine: RoutineDefinition, due: string, manual: boolean): Promise<void> {
    const key = routineKey(persona, routine.id);
    const now = new Date(this.now());
    const day = shortDate(new Date(due), now).split(",")[0];
    const session = await this.host.spawn(persona, { title: `${routine.name} · ${day}`, schedule: { id: key, due } });
    await this.wakes.deliver(session, {
      source: { kind: "schedule", id: key, label: `${routine.name} · ${describeSchedule({ cron: routine.cron }, now)}` },
      text: routine.prompt,
      due,
      // A new session is free: this never waits behind anything.
      policy: "queue",
      ...(manual ? {} : new Date(due).getTime() < this.startedAt ? { late: true as const } : {}),
    });
  }
}
