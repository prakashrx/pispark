import type {
  Item,
  ItemsPage,
  LiveDoc,
  LiveEvent,
} from "../../../../server/src/protocol";
import { applyOp } from "../../../../server/src/stream-ops";
import type { Json } from "../../../../server/src/stream-ops";
import { toMessage, type ChatView, type NativeMessage } from "./chat-view";

const PAGE = 40;
type Get = <T>(path: string) => Promise<T>;

/**
 * One open chat as the browser holds it: history read by cursor from Pi's session, plus the live
 * document (session state and the items in flight) kept current by the server's operations.
 */
export class LiveChat {
  doc = $state<LiveDoc>();
  /** Finalized items, oldest first. */
  history = $state<Item[]>([]);
  /** Whether older items exist than the ones loaded. */
  more = $state(false);
  /** The session's last entry id as far as `history` goes; `undefined` until history is loaded. */
  private head: string | null | undefined;
  private seq = 0;
  private readonly messages = new WeakMap<Item, NativeMessage>();

  constructor(private readonly get: Get) {}

  /** Everything in order: history, then what is still in flight. */
  readonly items = $derived.by(() => {
    const keys = new Set(this.history.map((item) => item.key));
    return [...this.history, ...(this.doc?.tail ?? []).filter((item) => !keys.has(item.key))];
  });
  /** The existing conversation components' view of the chat. */
  readonly view = $derived.by((): ChatView | undefined => {
    const doc = this.doc;
    if (!doc) return undefined;
    // Finalized items never change, so their presentation is made once.
    const finalized = new Set(this.history);
    const messages = this.items.map((item) => {
      if (!finalized.has(item)) return toMessage(item);
      let message = this.messages.get(item);
      if (!message) this.messages.set(item, (message = toMessage(item)));
      return message;
    });
    return { ...doc.session, messages };
  });

  get loaded() {
    return this.head !== undefined;
  }
  reset() {
    this.doc = undefined;
    this.history = [];
    this.more = false;
    this.head = undefined;
    this.seq = 0;
  }

  /** The newest items. */
  async load(id: string) {
    const page = await this.get<ItemsPage>(`/api/sessions/${id}/items?limit=${PAGE}`);
    this.history = page.items;
    this.more = page.more;
    this.head = page.head;
  }
  async loadEarlier(id: string) {
    const first = this.history[0]?.id;
    if (!first || !this.more) return;
    const page = await this.get<ItemsPage>(`/api/sessions/${id}/items?before=${first}&limit=${PAGE}`);
    this.history = [...page.items, ...this.history];
    this.more = page.more;
  }
  /** Fetch what the session gained since `head`, however much that is. */
  private async catchUp(id: string) {
    if (!this.head) return this.load(id);
    let cursor = this.head;
    for (;;) {
      const page = await this.get<ItemsPage>(`/api/sessions/${id}/items?after=${cursor}&limit=100`);
      this.append(page.items);
      if (!page.more) {
        this.head = page.head;
        return;
      }
      cursor = page.items.at(-1)!.id!;
    }
  }
  private append(items: Item[]) {
    const known = new Set(this.history.map((item) => item.id));
    const added = items.filter((item) => !known.has(item.id));
    if (added.length) this.history = [...this.history, ...added];
  }

  /** Applies one event; `false` means the stream is out of step and must be opened again. */
  async apply(id: string, event: LiveEvent): Promise<boolean> {
    if (event.type === "snapshot") {
      this.doc = event.doc;
      this.seq = 0;
      if (event.head !== this.head) await this.catchUp(id);
      return true;
    }
    if (!this.doc || event.seq !== this.seq + 1) return false;
    this.seq = event.seq;
    for (const op of event.ops) {
      if (op.op === "commit") {
        if (op.after !== this.head) return false;
        if (op.items) {
          this.append(op.items);
          this.head = op.head;
        } else await this.catchUp(id);
      } else applyOp(this.doc as unknown as { [key: string]: Json }, op);
    }
    return true;
  }
}
