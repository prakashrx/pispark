import type { Wake } from "./wakes.js";

/** What arrived for a session while it works: a wake that has to wait for it, or a message from above (the person's, its parent's). */
export type Arrival = Wake | "message";

/**
 * Tells whoever waits inside a session's turn that something arrived for the session, so a wait
 * can take what it waited for and can end early on what needs the session now. It only tells:
 * what arrived is kept where it always is (a wake in `Wakes`, a message in Pi's own queue).
 */
export class Arrivals {
  private readonly listeners = new Map<string, Set<(what?: Arrival) => void>>();

  /** The next thing to arrive for a session; undefined when `signal` ends the wait first. */
  next(sessionId: string, signal: AbortSignal): Promise<Arrival | undefined> {
    if (signal.aborted) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const listeners = this.listeners.get(sessionId) ?? new Set();
      this.listeners.set(sessionId, listeners);
      const done = (what?: Arrival) => {
        listeners.delete(done);
        if (!listeners.size) this.listeners.delete(sessionId);
        signal.removeEventListener("abort", aborted);
        resolve(what);
      };
      const aborted = () => done();
      listeners.add(done);
      signal.addEventListener("abort", aborted, { once: true });
    });
  }

  tell(sessionId: string, what: Arrival): void {
    for (const listener of [...(this.listeners.get(sessionId) ?? [])]) listener(what);
  }
}
