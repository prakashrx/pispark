import type { ScheduleInput, ScheduleList, ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
import { CommandFailed, type Transport } from "../workspace/transport";

/**
 * Every schedule, as the server keeps them, and what a person does to them. Read again with the
 * session list and after every change, so last runs and next times stay current.
 */
export class ScheduleClient {
  schedules = $state<ScheduleSummary[]>([]);
  /** Pause all. */
  paused = $state(false);
  loaded = $state(false);

  constructor(private readonly transport: Transport) {}

  async refresh(): Promise<void> {
    const list = await this.transport.json<ScheduleList>("/api/schedules");
    this.schedules = list.schedules;
    this.paused = list.paused;
    this.loaded = true;
  }
  /** One session's schedules, in the order they were added. */
  of(sessionId: string): ScheduleSummary[] {
    return this.schedules.filter((schedule) => schedule.sessionId === sessionId);
  }
  /** A schedule that can wake the session, for the sidebar's clock. */
  active(sessionId: string): ScheduleSummary | undefined {
    return this.schedules.find((schedule) => schedule.sessionId === sessionId && schedule.on && !schedule.held);
  }
  add(input: ScheduleInput & { sessionId: string }): Promise<unknown> {
    return this.post("/api/schedules", input);
  }
  update(id: string, input: ScheduleInput): Promise<unknown> {
    return this.post(`/api/schedules/${id}`, input);
  }
  remove(id: string): Promise<unknown> {
    return this.post(`/api/schedules/${id}/remove`);
  }
  /** Run now: refused (`busy`) while the session works or waits. */
  run(id: string): Promise<unknown> {
    return this.post(`/api/schedules/${id}/run`);
  }
  /** A change, then the list again; a refusal is thrown in words. */
  private async post(path: string, body?: unknown): Promise<unknown> {
    try {
      return await this.transport.json(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
    } catch (error) {
      throw new CommandFailed((error as Error).message);
    } finally {
      await this.refresh().catch(() => {});
    }
  }
}
