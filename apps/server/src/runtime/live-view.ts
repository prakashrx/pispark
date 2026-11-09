import type { Item, LiveDoc, LiveEvent, LiveOp } from "../protocol.js";
import { diffOps } from "../stream-ops.js";
import type { Json } from "../stream-ops.js";

/** What a live view reads from a running chat. */
export interface LiveSource {
  doc(): LiveDoc;
  head(): string | null;
  /** Items the session gained after an entry; `undefined` when that entry is not on the branch. */
  since(after: string | null): Item[] | undefined;
}

/** A commit larger than this is announced without its items; the client reads them as history. */
const COMMIT_LIMIT = 256 * 1024;

/**
 * One connection's view of a chat: the document it last saw. Each tick turns what changed into
 * operations, so a growing answer costs what it grew by, not its whole length again.
 */
export class LiveView {
  private doc: LiveDoc;
  private head: string | null;
  private seq = 0;
  constructor(
    private readonly sessionId: string,
    private readonly source: LiveSource,
  ) {
    this.doc = source.doc();
    this.head = source.head();
  }
  snapshot(): LiveEvent {
    return { type: "snapshot", sessionId: this.sessionId, head: this.head, doc: this.doc };
  }
  /** The next batch of operations, or nothing when the chat did not change. */
  next(): LiveEvent | undefined {
    const ops: LiveOp[] = [];
    const head = this.source.head();
    if (head !== this.head) {
      const items = this.source.since(this.head);
      const commit: LiveOp = { op: "commit", after: this.head, head };
      if (items && JSON.stringify(items).length <= COMMIT_LIMIT) commit.items = items;
      ops.push(commit);
      this.head = head;
    }
    const doc = this.source.doc();
    ops.push(...diffOps(this.doc as unknown as Json, doc as unknown as Json));
    this.doc = doc;
    if (!ops.length) return undefined;
    return { type: "ops", sessionId: this.sessionId, seq: ++this.seq, ops };
  }
}
