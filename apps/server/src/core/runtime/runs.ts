import type { RoutineRun } from "../../contract/schedule-protocol.js";
import { listAgents, unattendedOf } from "../agents/resolve.js";
import { RuntimeError } from "./errors.js";
import type { SessionAccess } from "./session-access.js";

/** Runs of one schedule or routine kept in use; older ones are archived as new ones start. */
const RUNS_KEPT = 10;

/**
 * Runs in a new session: a schedule's run (a child of its owner) or a routine's (a session of the
 * agent). Each run is named for its schedule, and only the newest are kept in use.
 */
export class Runs {
  constructor(private readonly sessions: SessionAccess) {}

  /**
   * A schedule's run in its own session: a child of the owner, with the owner's agent, folder and
   * model, named for the run. The clock sends it the prompt.
   */
  async schedule(owner: string, run: { title: string; schedule: { id: string; due: string } }): Promise<string> {
    const { storage, create } = this.sessions;
    const parent = storage.read(owner);
    if (parent.parent || parent.archived) throw new RuntimeError("busy");
    const doc = await create({ agent: parent.agent, ...(parent.model ? { model: parent.model } : {}) }, { parent: owner, title: run.title, schedule: run.schedule });
    await this.prune(run.schedule.id, doc.id);
    return doc.id;
  }

  /** A routine's run: a new session of its agent, named for the run. */
  async routine(agent: string, run: { title: string; schedule: { id: string; due: string } }): Promise<string> {
    const doc = await this.sessions.create({ agent }, { title: run.title, schedule: run.schedule });
    await this.prune(run.schedule.id, doc.id);
    return doc.id;
  }

  /** The sessions a schedule's or routine's runs made, newest first. */
  of(key: string): RoutineRun[] {
    return this.sessions.storage
      .list()
      .filter((metadata) => metadata.schedule?.id === key)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((metadata) => ({
        session: metadata.id,
        due: metadata.schedule!.due,
        ...(metadata.title ? { title: metadata.title } : {}),
        ...(metadata.archived ? { archived: true as const } : {}),
      }));
  }

  /** Every agent that offers routines, with which are switched on. One that cannot be read offers none. */
  routineAgents() {
    const { agents } = this.sessions;
    return listAgents(agents).flatMap((agent) => {
      if (!agent.valid) return [];
      try {
        const { routines } = unattendedOf(agents, { agent: agent.id });
        return routines.length ? [{ id: agent.id, name: agent.name, ...(agent.home ? { home: agent.home } : {}), routines }] : [];
      } catch {
        return [];
      }
    });
  }

  /**
   * Keeps the newest runs of a schedule or routine in use: older ones that have settled and wait for
   * nobody are archived (and can be restored).
   */
  private async prune(schedule: string, keep: string): Promise<void> {
    const older = this.of(schedule)
      .filter((run) => !run.archived && run.session !== keep)
      .slice(RUNS_KEPT - 1);
    for (const { session } of older) {
      const live = this.sessions.live(session);
      if (live && (!live.settled || live.asking)) continue;
      await this.sessions.archive(session).catch(() => {});
    }
  }
}
