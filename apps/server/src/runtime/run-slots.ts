/**
 * How many chats may run at once, and who waits for a turn. A chat holds a slot while its agent
 * works; one waiting on a person gives it up. Waiters start in order, except that a run resuming
 * after an answer goes before prompts that have not started.
 */
export class RunSlots {
  private readonly holders = new Set<string>();
  private waiting: { id: string; go: () => void; resuming: boolean }[] = [];

  constructor(private limit: number) {}

  get max(): number {
    return this.limit;
  }
  setLimit(limit: number): void {
    this.limit = limit;
    this.drain();
  }
  holds(id: string): boolean {
    return this.holders.has(id);
  }
  /** Whether this chat waits for a slot. */
  queued(id: string): boolean {
    return this.waiting.some((waiter) => waiter.id === id);
  }

  /** Takes a slot now if one is free and nobody waits for it. */
  take(id: string): boolean {
    if (this.holders.has(id)) return true;
    if (this.holders.size >= this.limit || this.waiting.length) return false;
    this.holders.add(id);
    return true;
  }
  /** Runs `go` once this chat has a slot, holding it from then on. */
  wait(id: string, go: () => void, resuming = false): void {
    const waiter = { id, go, resuming };
    if (resuming) {
      const firstPrompt = this.waiting.findIndex((other) => !other.resuming);
      if (firstPrompt < 0) this.waiting.push(waiter);
      else this.waiting.splice(firstPrompt, 0, waiter);
    } else this.waiting.push(waiter);
    this.drain();
  }
  /** Stops waiting, without running what waited. */
  withdraw(id: string): void {
    this.waiting = this.waiting.filter((waiter) => waiter.id !== id);
  }
  /** Gives a slot back; the next waiter starts. Whether this chat held one. */
  release(id: string): boolean {
    if (!this.holders.delete(id)) return false;
    this.drain();
    return true;
  }

  private drain(): void {
    while (this.holders.size < this.limit && this.waiting.length) {
      const next = this.waiting.shift()!;
      this.holders.add(next.id);
      next.go();
    }
  }
}
