import { WORKSPACE_AREAS, type WorkspaceArea } from "../contract/protocol.js";

/**
 * What the workspace stream (`GET /api/live`) watches: each area is read the way its endpoint reads
 * it, and a client is told only which areas changed, so it re-reads those instead of polling all of
 * them. A loaded session's change is looked at within ~0.1 s (`poke`); everything else (a schedule
 * coming due, a process ending, an update) within the tick. Nothing is read while no one listens.
 */
export class WorkspaceLive {
  private readonly last = new Map<WorkspaceArea, string>();
  private readonly listeners = new Set<(areas: WorkspaceArea[]) => void>();
  private ticker?: ReturnType<typeof setInterval>;
  private soon?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly read: Record<WorkspaceArea, () => unknown>,
    private readonly tickMs = 2000,
    private readonly pokeMs = 100,
  ) {}

  /** Listen for changed areas; the first listener starts the watching, the last one stops it. */
  listen(listener: (areas: WorkspaceArea[]) => void): () => void {
    if (!this.listeners.size) {
      for (const area of WORKSPACE_AREAS) this.last.set(area, this.key(area));
      this.ticker = setInterval(() => this.check(), this.tickMs);
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size) return;
      clearInterval(this.ticker);
      clearTimeout(this.soon);
      this.ticker = this.soon = undefined;
      this.last.clear();
    };
  }
  /** Something probably changed: look soon, once for a burst. */
  poke(): void {
    if (!this.listeners.size || this.soon) return;
    this.soon = setTimeout(() => {
      this.soon = undefined;
      this.check();
    }, this.pokeMs);
  }
  close(): void {
    this.listeners.clear();
    clearInterval(this.ticker);
    clearTimeout(this.soon);
  }

  private key(area: WorkspaceArea): string {
    try {
      return JSON.stringify(this.read[area]());
    } catch {
      // An area that can't be read now is "unknown": it counts as changed once it reads again.
      return "";
    }
  }
  private check(): void {
    const changed = WORKSPACE_AREAS.filter((area) => {
      const key = this.key(area);
      if (key === this.last.get(area)) return false;
      this.last.set(area, key);
      return true;
    });
    if (changed.length) for (const listener of [...this.listeners]) listener(changed);
  }
}
