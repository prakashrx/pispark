export interface SessionChange {
  sessionId: string;
  sequence: number;
  type: "changed";
}

/** Invalidation, not a token replay log. Slow readers retain only the latest sequence and resnapshot. */
export class SessionChanges implements AsyncIterableIterator<SessionChange> {
  private pending?: SessionChange;
  private waiting?: (result: IteratorResult<SessionChange>) => void;
  private closed = false;
  constructor(private readonly onClose: () => void) {}
  push(event: SessionChange): void {
    if (this.closed) return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve({ value: event, done: false });
    } else this.pending = event;
  }
  next(): Promise<IteratorResult<SessionChange>> {
    if (this.waiting)
      return Promise.reject(
        new Error("Only one pending observation read is permitted"),
      );
    if (this.pending) {
      const value = this.pending;
      this.pending = undefined;
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }
  return(): Promise<IteratorResult<SessionChange>> {
    this.close();
    return Promise.resolve({ value: undefined, done: true });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending = undefined;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
    this.onClose();
  }
  [Symbol.asyncIterator](): AsyncIterableIterator<SessionChange> {
    return this;
  }
}
