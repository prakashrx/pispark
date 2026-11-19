import type { ThinkingLevel } from "../../../../server/src/contract/agent-protocol";
import type { Json } from "../../../../server/src/contract/stream-ops";
import type {
  CallRequest,
  CallResponse,
  ExtensionContribution,
  Item,
  PartPage,
  Receipt,
  SessionDoc,
  SessionInfo,
  ToolProgress,
  SessionFile,
} from "../../../../server/src/contract/protocol";
import type { CommandUncertaintyKind } from "./session-presentation";
import { contributionsFor } from "./extension-views";
import { LiveSession } from "./live-session.svelte";
import { liveEvents } from "./live-stream";
import { CommandFailed, CommandUncertainty, type Transport } from "./transport";
import { Attachments } from "./attachments.svelte";

/** What a session needs from the app that holds it. */
export interface SessionHost {
  /** The session reported new state: the session list keeps its row in step. */
  changed(session: SessionDoc): void;
  /** Read the session list again. */
  refresh(): Promise<void>;
  /** Whether one more session may hold an unsent draft. */
  roomForDraft(): boolean;
  /** Something to say that is not about this session alone. */
  notice(message: string): void;
}

/**
 * One session in the browser: the web's counterpart of the server's `Session`. It holds what the session
 * is doing now (its state, its items as they stream, what running tools report), follows it live
 * while it is on screen, and has the actions a person can take.
 *
 * Every view of a session is given this object and nothing else: PiSpark's own conversation, and
 * the views extensions offer. The members up to `showView` are what a view may rely on.
 */
export class Session {
  /** Reading position across workspace screens. Undefined follows the live end. */
  readingTop?: number;
  /** Everything about the session except its history: status, title, model, queue, what extensions show. */
  get doc(): SessionDoc | undefined {
    return this.live.doc?.session;
  }
  /** The session as the list knows it, until its own state has arrived. */
  get info(): SessionInfo | undefined {
    return this.doc ?? this.row;
  }
  /** Everything in order, oldest first: saved items, then what is still being written. */
  get items(): Item[] {
    return this.live.items;
  }
  /** Older items exist than the ones read so far (`loadEarlier`). */
  get more(): boolean {
    return this.live.more;
  }
  /** What running tools have reported so far, by call id. */
  get progress(): Record<string, ToolProgress> {
    return this.live.doc?.progress ?? {};
  }
  /** "Live" while the session is followed; otherwise why not ("Reconnecting", "Disconnected", …). */
  connection = $state("Connected");
  /** The session has nothing to show yet. */
  opening = $state(true);
  /** What went wrong with the last thing asked of this session, in words. */
  error = $state("");
  errorKind = $state<CommandUncertaintyKind>();
  /** The server's code for the failure, when a command failed there ("execution": the run failed). */
  errorCode = $state<string>();
  /** The unsent reply. Kept while other sessions are shown. */
  draft = $state("");
  /** A message is being handed to the server. */
  sending = $state(false);

  /** Files added to the reply draft, uploaded as they are added. */
  readonly attachments = new Attachments();
  setDraft(text: string) {
    if (text && !this.draft && !this.host.roomForDraft())
      return this.host.notice("Draft limit: clear an existing draft before starting another.");
    this.draft = text.slice(0, 65536);
    this.draftRevision++;
  }
  /**
   * Sends a message to an idle session: the given text, or the draft (cleared once it is accepted,
   * unless it changed meanwhile). Whether the server accepted it; a failure is in `error`.
   */
  async send(text?: string): Promise<boolean> {
    const message = text ?? this.draft;
    const revision = this.draftRevision;
    // After a failed reply the next message goes too: the server starts the session again first.
    if (this.sending || !message.trim() || !["idle", "error"].includes(this.doc?.status ?? "")) return false;
    // The draft's attachments go with it, each named where it sits; a given text carries none.
    const placed = text === undefined ? this.attachments.placed(message) : [];
    if (placed.length && this.attachments.blocked) {
      this.error = this.attachments.blocked;
      return false;
    }
    const outgoing = placed.length ? this.attachments.outgoing(message) : { text: message, attachments: [] };
    this.sending = true;
    this.clearError();
    try {
      const receipt = await this.transport.submit({
        type: "start",
        sessionId: this.id,
        text: outgoing.text,
        ...(outgoing.attachments.length ? { attachments: outgoing.attachments } : {}),
      });
      if (receipt.error) throw new CommandFailed(receipt.error);
      if (text === undefined && this.draftRevision === revision) {
        this.draft = "";
        this.attachments.sent(placed);
      }
      this.watch(receipt);
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    } finally {
      this.sending = false;
    }
  }
  /** Stops the run, or takes a message that waits for its turn off the queue. */
  async stop() {
    this.clearError();
    await this.command({ type: "cancel", sessionId: this.id });
  }
  /** Answers a question an extension is waiting on; null dismisses it. */
  async answer(dialogId: string, value: string | boolean | null) {
    await this.command({ type: "answer", sessionId: this.id, dialogId, value });
  }
  /** Reads the next older items in; `false` when that failed. */
  async loadEarlier(): Promise<boolean> {
    try {
      await this.live.loadEarlier(this.id);
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }
  /** A chunk of a long text part that arrived clipped. */
  readPart(ref: { id: string; part: number }, offset: number) {
    return this.transport.json<PartPage>(`/api/sessions/${this.id}/items/${ref.id}/parts/${ref.part}?offset=${offset}`);
  }
  /**
   * Restarts the session's Pi session so agent changes apply; with a model, it runs that one from now
   * on (a read-only session whose model is gone goes on this way). The transcript is kept.
   */
  async reload(model?: { provider: string; id: string }) {
    this.clearError();
    this.source?.abort();
    this.connection = "Connecting";
    try {
      await this.transport.run({ type: "reload", sessionId: this.id, ...(model ? { model } : {}) });
      await this.host.refresh();
    } catch (error) {
      this.fail(error);
    }
    if (this.shown && !this.transport.closed) this.observe();
  }
  /** Between replies: another model or thinking level from the next reply on. Throws so the picker can say why. */
  async configure(change: { model?: { provider: string; id: string }; thinking?: ThinkingLevel }) {
    await this.transport.run({ type: "configure", sessionId: this.id, ...change });
  }
  /** The session's files: what the person attached and what the agent made (its artifacts). */
  async files(): Promise<SessionFile[]> {
    const files = (await this.transport.json<{ files?: SessionFile[] }>(`/api/sessions/${this.id}/attachments`)).files;
    return Array.isArray(files) ? files : [];
  }
  /** A person names the session; it keeps that name. Throws so the form can say why. */
  async rename(title: string) {
    await this.transport.run({ type: "rename", sessionId: this.id, title });
    await this.host.refresh();
  }
  /** Follows the session again after the connection was lost. Never sends a message again. */
  async reconnect() {
    try {
      await this.host.refresh();
      if (this.shown) await this.show();
    } catch {
      this.connection = "Disconnected";
      this.host.notice("Reconnect failed. No prompt was resent.");
    }
  }
  /**
   * An extension component's `host.call(name, data)`: runs a function its own placement gave it
   * and resolves with the result, or rejects with the extension's own message.
   */
  async call(point: string, key: string, name: string, data?: unknown): Promise<unknown> {
    const request: CallRequest = { point, key, name, ...(data === undefined ? {} : { data: data as Json }) };
    const response = await fetch(`/api/sessions/${this.id}/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.any([this.transport.signal, AbortSignal.timeout(40_000)]),
    });
    const answer = (await response.json()) as CallResponse;
    if (!response.ok || answer.error) throw new Error(answer.detail ?? answer.error ?? "The call failed");
    return answer.result;
  }
  /** An extension component's `host.file(path)`: the address of a file in the folder its placement named. */
  fileUrl(point: string, key: string, path: string): string {
    return `/api/sessions/${this.id}/files?${new URLSearchParams({ point, key, path })}`;
  }

  // ---- What shows the session ------------------------------------------------------------------

  /** The whole views extensions offer of this session (`session.view`), in the order first offered. */
  get views(): ExtensionContribution[] {
    return contributionsFor(this.doc?.extensions, "session.view");
  }
  /**
   * The key of the view that shows; none while the conversation does. It is the person's choice
   * for this session and, until they make one, the home view of an app agent.
   */
  get shownView(): string | undefined {
    const key = this.chosenView ?? this.info?.agent?.home;
    return key && this.views.some((view) => view.key === key) ? key : undefined;
  }
  /**
   * Shows a view, or the conversation (no key). The choice is kept for this session in the
   * browser: a view that is not offered yet shows once it is.
   */
  showView(key?: string) {
    this.chosenView = key ?? "";
    try {
      localStorage.setItem(viewChoice(this.id), this.chosenView);
    } catch {
      /* The choice lasts for this visit when browser storage is unavailable. */
    }
  }

  // ---- For the app that holds the session --------------------------------------------------------

  /** The session's row in the session list. */
  row = $state<SessionInfo>();
  /** The session's history and live document, as the server's operations keep them. */
  readonly live: LiveSession;
  /** The view the person chose: "" is the conversation, unset is no choice yet. */
  private chosenView = $state<string>();
  /** How often each view had asked to be shown when last looked; unset until the session shows. */
  private asked?: Map<string, number>;
  private draftRevision = 0;
  /** The last draft an extension set that this session applied, so each fills the reply box once. */
  private extensionDraft?: string;
  private source?: AbortController;
  private shown = false;
  private showing = 0;

  constructor(
    readonly id: string,
    private readonly transport: Transport,
    private readonly host: SessionHost,
  ) {
    this.live = new LiveSession((path) => transport.json(path));
    try {
      this.chosenView = localStorage.getItem(viewChoice(id)) ?? undefined;
    } catch {
      /* The conversation shows when browser storage is unavailable. */
    }
  }

  /** The session is on screen: load it on the server if it is not, then follow it live. */
  async show() {
    const showing = ++this.showing;
    this.shown = true;
    this.asked = undefined;
    this.source?.abort();
    // Only a session with nothing to show yet is opening; one seen before shows as it was.
    this.opening = !this.live.doc;
    if (this.connection === "Unloaded") this.connection = "Connected";
    try {
      if (this.row?.status === "unloaded") await this.transport.run({ type: "open", sessionId: this.id });
      if (showing !== this.showing || this.transport.closed) return;
      this.observe();
    } catch (error) {
      this.fail(error);
      if (showing === this.showing) {
        this.opening = false;
        this.connection = "Disconnected";
      }
    }
  }
  /** The session left the screen: stop following it. What it showed is kept for the next time. */
  hide() {
    this.shown = false;
    this.showing++;
    this.source?.abort();
  }
  /** The network went away. */
  offline() {
    this.source?.abort();
    this.connection = "Reconnecting";
  }
  fail(error: unknown) {
    this.error = (error as Error).message;
    this.errorKind = error instanceof CommandUncertainty ? error.kind : undefined;
    this.errorCode = error instanceof CommandFailed ? error.code : undefined;
  }
  private clearError() {
    this.error = "";
    this.errorKind = undefined;
    this.errorCode = undefined;
  }
  private async command(command: Parameters<Transport["run"]>[0]) {
    try {
      await this.transport.run(command);
    } catch (error) {
      this.fail(error);
    }
  }
  private watch(receipt: Receipt) {
    void this.transport.settled(receipt).catch((error) => {
      if (!this.transport.closed) this.fail(error);
    });
  }
  private observe() {
    this.source?.abort();
    const source = new AbortController();
    this.source = source;
    const { id } = this;
    void (async () => {
      while (!source.signal.aborted && !this.transport.closed) {
        try {
          // History is read once; a reconnect only catches up on what the session gained since.
          if (!this.live.loaded) await this.live.load(id);
          const response = await fetch(`/api/sessions/${id}/live`, {
            signal: AbortSignal.any([source.signal, AbortSignal.timeout(70_000)]),
          });
          let end: "closed" | "unloaded" | "resync" = "closed";
          let received = false;
          for await (const event of liveEvents(response)) {
            if (source !== this.source || source.signal.aborted) return;
            if (event.sessionId !== id) throw new Error("Invalid event");
            if (event.type === "unloaded") {
              end = "unloaded";
              break;
            }
            if (!(await this.live.apply(id, event))) {
              end = "resync";
              break;
            }
            received = true;
            const session = this.live.doc!.session;
            this.applyExtensionDraft(session, event.type === "snapshot");
            this.applyAttention();
            this.opening = false;
            this.connection = "Live";
            this.host.changed(session);
          }
          // The server ends every live stream after a while on purpose: follow on at once, still Live.
          if (end === "closed" && received) {
            if (source !== this.source || source.signal.aborted) return;
            continue;
          }
          if (end === "unloaded") {
            if (source !== this.source || source.signal.aborted) return;
            // The server unloaded the session while it was idle: load it again and carry on.
            try {
              await this.transport.run({ type: "open", sessionId: id });
            } catch (error) {
              // "owned": a reply sent meanwhile already loaded it again.
              if (!(error instanceof CommandFailed && error.code === "owned")) {
                this.connection = "Unloaded";
                return;
              }
            }
            continue;
          }
        } catch {
          /* Lost connection or bounded decoder rejection: reconnect from a fresh snapshot, never resend commands. */
        }
        if (source.signal.aborted || this.transport.closed) return;
        // Keep showing the last state; the reply box stays disabled until Live.
        this.connection = "Reconnecting";
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    })();
  }
  /** An extension called Pi's `setEditorText`: put its text in this session's reply box. */
  private applyExtensionDraft(session: SessionDoc, initial: boolean) {
    const draft = session.extensions?.draft;
    if (!draft || this.extensionDraft === draft.id) return;
    this.extensionDraft = draft.id;
    // When a session is opened, only a fresh draft counts (a new session's first run may set one);
    // an older one was meant for an earlier view, and a typed reply always wins.
    if (initial && (Date.now() - draft.at > 30_000 || this.draft)) return;
    this.draft = draft.text;
    this.draftRevision++;
  }
  /**
   * A view asked to be shown while the person is looking at the session: show it. What views had
   * asked before the session came on screen is only noted, so opening a session replays nothing.
   */
  private applyAttention() {
    const before = this.asked;
    this.asked = new Map(this.views.map((view) => [view.key, view.attention ?? 0]));
    if (!before) return;
    const asking = this.views.findLast((view) => (view.attention ?? 0) > (before.get(view.key) ?? 0));
    if (asking) this.showView(asking.key);
  }
}

/** Where the browser keeps the view a person last chose for a session. */
const viewChoice = (sessionId: string) => `pispark:view:${sessionId}`;
/** A deleted session's view choice goes with it. */
export function forgetViewChoice(sessionId: string) {
  try {
    localStorage.removeItem(viewChoice(sessionId));
  } catch {
    /* Nothing was kept. */
  }
}
