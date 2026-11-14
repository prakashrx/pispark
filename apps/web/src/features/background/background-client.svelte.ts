import type { Routine, RoutineList } from "../../../../server/src/contract/schedule-protocol";
import type { ProcessInfo, ProcessList, ProcessOutput } from "../../../../server/src/contract/process-protocol";
import { CommandFailed, type Transport } from "../workspace/transport";

async function post(transport: Transport, path: string, body?: unknown): Promise<unknown> {
  try {
    return await transport.json(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  } catch (error) {
    throw new CommandFailed((error as Error).message);
  }
}

/** The routines personas offer, read with the session list and after every change. */
export class RoutineClient {
  routines = $state<Routine[]>([]);
  loaded = $state(false);
  constructor(private readonly transport: Transport) {}
  async refresh(): Promise<void> {
    const list = await this.transport.json<RoutineList>("/api/routines");
    this.routines = Array.isArray(list?.routines) ? list.routines : [];
    this.loaded = true;
  }
  of(persona: string): Routine[] {
    return this.routines.filter((routine) => routine.persona.id === persona);
  }
  async set(routine: Routine, on: boolean): Promise<void> {
    try {
      await post(this.transport, `/api/routines/${routine.persona.id}/${encodeURIComponent(routine.id)}`, { on });
    } finally {
      await this.refresh().catch(() => {});
    }
  }
  async run(routine: Routine): Promise<void> {
    try {
      await post(this.transport, `/api/routines/${routine.persona.id}/${encodeURIComponent(routine.id)}/run`);
    } finally {
      await this.refresh().catch(() => {});
    }
  }
}

/** Processes sessions started: every running one (read with the session list), and one session's. */
export class ProcessClient {
  running = $state<ProcessList["processes"]>([]);
  constructor(private readonly transport: Transport) {}
  async refresh(): Promise<void> {
    const list = await this.transport.json<ProcessList>("/api/processes");
    this.running = Array.isArray(list?.processes) ? list.processes : [];
  }
  async of(sessionId: string): Promise<ProcessInfo[]> {
    return (await this.transport.json<{ processes: ProcessInfo[] }>(`/api/sessions/${sessionId}/processes`)).processes;
  }
  output(sessionId: string, id: string, since: number): Promise<ProcessOutput> {
    return this.transport.json<ProcessOutput>(`/api/sessions/${sessionId}/processes/${id}/output?since=${since}`);
  }
  async stop(sessionId: string, id: string): Promise<void> {
    try {
      await post(this.transport, `/api/sessions/${sessionId}/processes/${id}/stop`);
    } finally {
      await this.refresh().catch(() => {});
    }
  }
}

/** The process a conversation row asked to show; the Processes panel opens on it. */
export const processPanel = $state<{ sessionId?: string; processId?: string }>({});
export function showProcess(sessionId: string, processId?: string): void {
  processPanel.sessionId = sessionId;
  processPanel.processId = processId;
}
