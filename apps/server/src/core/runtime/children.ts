import type { Answer, Heard, Verb } from "../../contract/verbs.js";
import type { StatusDetails, WokenDetails } from "../../contract/wake-protocol.js";
import { isAbsolute, join } from "node:path";
import type { Ask, SessionDoc } from "../../contract/protocol.js";
import { AgentError } from "../agents/format.js";
import type { AgentStore } from "../agents/store.js";
import { validateText, type RunResult, type Session } from "./session.js";
import { toolSessionTitle } from "./session-title.js";
import { runtimeError } from "./errors.js";
import type { Handles } from "./handles.js";
import type { Kind, Listed, Taken } from "./started.js";
import type { SessionMetadata } from "./storage.js";
import { titleOf, type SessionAccess } from "./session-access.js";
import type { Wake } from "./wakes.js";

/** A child's result data as the parent's agent reads it, if it fits in `room` characters. */
function dataText(data: unknown, room: number): string {
  if (data === undefined) return "";
  for (const text of [JSON.stringify(data, null, 2), JSON.stringify(data)])
    if (text.length + 16 <= room) return `\n\nIts data:\n${text}`;
  return "\n\n(It also set data, too large to show here; this session's extensions received it.)";
}
/** What a child said, short enough for its parent's agent. */
const cut = (text: string) => (text.length > 8192 ? `${text.slice(0, 8192)}…\n(cut; pispark_look shows what it last said)` : text);
const short = (text: string) => (text.length > 160 ? `${text.slice(0, 159)}…` : text);

/** Why a session could not be started, for whoever asked for it. A wrong agent is answered with the ones there are. */
function notStarted(error: unknown, agents: AgentStore): Answer {
  if (error instanceof AgentError) return { ok: false, text: `That agent definition cannot be used: ${error.code}${error.detail ? ` (${error.detail})` : ""}.` };
  const { code } = runtimeError(error, "execution");
  if (code === "agent") {
    const usable = agents.list().filter((agent) => agent.valid).map(({ id, name }) => ({ id, name }));
    return { ok: false, text: `There is no such agent, or it cannot be used now. The agents here: ${usable.map(({ id }) => id).join(", ")}.`, data: { agents: usable } };
  }
  if (code === "invalid-input" || code === "folder") return { ok: false, text: "That folder cannot be used: it must exist, and a project agent works only in its own." };
  return { ok: false, text: `The session could not be started (${code}).` };
}

type Report = NonNullable<Wake["report"]>;
/** Picks, among what waits for a parent, one child's messages of one kind. */
const from = (childId: string, word?: Wake["word"]) => (wake: Wake) => wake.source.id === childId && (word === undefined || wake.word === word);

/**
 * Sessions started by other sessions, as one kind of thing a session can start: starting one,
 * telling it, looking at it and stopping it, and what goes up from it. A child answers its parent
 * once per ask, when it is at rest; at any time it may note (a line, no turn) or raise (its parent
 * is woken). One level only: a child cannot start sessions.
 */
export class Children implements Kind {
  readonly name = "session";

  constructor(
    private readonly sessions: SessionAccess,
    private readonly handles: Handles,
  ) {}

  /** The sessions this one started. */
  under(id: string): SessionMetadata[] {
    return this.sessions.storage.list().filter((metadata) => metadata.parent === id);
  }

  // ---- Down: what a parent does to its children -------------------------------------------------

  /**
   * A session started by another one, set up as the person sets one up: where it works (its
   * parent's folder unless given, or its agent's own), its agent (Default unless one is named, or
   * one made for it, kept as its own layer), its model (the agent's own unless given), and the
   * brief as its first message. It is named by its parent, or from the brief.
   */
  async start(owner: string, request: Omit<Extract<Verb, { verb: "start_session" }>, "verb">): Promise<Answer> {
    const parent = this.sessions.storage.read(owner);
    if (parent.parent) return { ok: false, text: "A session started by another session cannot start sessions." };
    validateText(request.brief);
    let title: string | undefined;
    try {
      title = request.title ? toolSessionTitle(request.title) : undefined;
    } catch {
      /* Named from its first message instead. */
    }
    const { agent, folder, model } = request;
    const slash = model?.indexOf("/") ?? -1;
    let doc: SessionDoc;
    try {
      doc = await this.sessions.create(
        {
          ...(folder ? { folder: isAbsolute(folder) ? folder : join(parent.cwd, folder) } : {}),
          ...(typeof agent === "string" ? { agent } : agent ? { layer: agent } : {}),
          ...(model ? { model: { provider: model.slice(0, slash), id: model.slice(slash + 1) } } : {}),
        },
        { parent: parent.id, ...(title ? { title } : {}), ...(request.collect ? { collect: true as const } : {}) },
      );
    } catch (error) {
      return notStarted(error, this.sessions.agents);
    }
    const session = this.sessions.get(doc.id);
    this.down(session, parent, "ask", request.brief, request.data, (brief) => void session.start(brief, this.from(parent)).completion.catch(() => {}));
    const handle = this.handles.of(owner, this.name, doc.id);
    return {
      ok: true,
      text: `Started "${titleOf(session.metadata)}" (${handle}). It works on its own; its answer arrives here as a message when it is done.`,
      details: { id: doc.id },
      data: { id: handle },
    };
  }

  /**
   * Something from a parent reaches its child. The child's extensions hear it first, with any data
   * the parent's side attached: they may reword it, or take it, in which case the agent is not
   * sent it and the child answers with whatever data they set.
   */
  private down(child: Session, parent: SessionMetadata, word: "ask" | "tell", text: string, data: unknown, send: (text: string) => void): void {
    const from: Heard["from"] = { kind: "parent", title: titleOf(parent) };
    const heard = child.hear({ word, from, text, ...(data !== undefined ? { data } : {}) });
    if (heard?.action !== "skip") return send(heard?.text ?? text);
    void this.rested(child.id);
  }

  of(owner: string): Listed[] {
    // Open while it owes an answer, or its answer still waits to be taken.
    return this.under(owner).map((child) => ({
      id: child.id,
      line: `"${titleOf(child)}" — ${this.state(child)}`,
      open: !child.archived && (!!child.ask || this.sessions.waiting(owner, child.id)),
    }));
  }

  async look(owner: string, id: string): Promise<Answer> {
    const child = this.child(owner, id);
    if (!child) return this.gone;
    const lines = [`"${titleOf(child)}" — ${this.state(child)}`];
    if (child.raise) lines.push(`It raised: ${child.raise}`);
    if (child.note) lines.push(`Its last note: ${child.note}`);
    // An answer still waiting to be sent here is taken by looking: it is shown now, and not sent.
    const answers = this.sessions.take(owner, from(child.id, "answer"));
    if (answers.length) lines.push(...answers.map((wake) => wake.text));
    else if (!child.archived) {
      await this.sessions.ensure(child.id);
      const said = this.sessions.get(child.id).lastReply();
      lines.push(said ? `It last said:\n${cut(said)}` : "It has not said anything yet.");
    }
    return { ok: true, text: lines.join("\n") };
  }

  /** Its parent stops it, and everything it started. The parent knows, so the ask is closed without an answer. */
  async stop(owner: string, id: string): Promise<Answer> {
    const child = this.child(owner, id);
    if (!child) return this.gone;
    const working = !(this.sessions.live(child.id)?.settled ?? true);
    if (!working && !child.ask) return { ok: true, text: "It is not working." };
    await this.sessions.ensure(child.id);
    this.sessions.get(child.id).closeAsk({ state: "stopped" });
    this.sessions.take(owner, from(child.id));
    this.sessions.stopProcesses(child.id);
    if (working) await this.sessions.cancel(child.id);
    return { ok: true, text: "Stopped." };
  }

  /**
   * Its parent tells it something. A child at rest is asked anew, and answers once more. A working
   * one reads it at its next pause (`now`) or when it has finished what it is doing (`after`).
   */
  async send(owner: string, id: string, { text, when, data }: { text?: string; when?: "now" | "after"; data?: unknown }): Promise<Answer> {
    const child = this.child(owner, id);
    if (!child) return this.gone;
    if (text === undefined) return { ok: false, text: "A session is sent text; raise_on is for a process." };
    if (child.archived) return { ok: false, text: "That session is archived." };
    this.sessions.admit();
    await this.sessions.ensure(child.id);
    validateText(text);
    const session = this.sessions.get(child.id);
    // Telling it something answers what it raised: a raise still waiting to be sent here is not sent.
    this.sessions.take(owner, from(child.id, "raise"));
    const parent = this.sessions.storage.read(owner);
    try {
      if (session.settled) {
        session.openAsk();
        this.down(session, parent, "ask", text, data, (words) => void session.start(words, this.from(parent)).completion.catch(() => {}));
        return { ok: true, text: "Sent. Its answer arrives here as a message when it is done." };
      }
      let queued: Promise<unknown> = Promise.resolve();
      this.down(session, parent, "tell", text, data, (words) => (queued = session.queue(words, when === "after" ? "follow-up" : "steer")));
      await queued;
      return { ok: true, text: when === "after" ? "Sent. It reads this when it has finished what it is doing." : "Sent. It reads this at its next pause." };
    } catch (error) {
      if (runtimeError(error, "execution").code === "busy") return { ok: false, text: "It cannot take a message right now; try again in a moment." };
      throw error;
    }
  }

  /** Its answer, as soon as it is in: taken from what waits for its parent, so it is not sent as well. */
  async wait(owner: string, id: string, _until: RegExp | undefined, signal: AbortSignal): Promise<Taken | undefined> {
    for (;;) {
      const child = this.child(owner, id);
      if (!child) return undefined;
      const report = this.sessions.take(owner, from(id, "answer"))[0]?.report;
      if (report) return { words: `"${report.title}" ${report.how}:\n\n${report.text}${dataText(report.data, 56 * 1024 - report.text.length)}`, ...report };
      if (!child.ask) return { words: `"${titleOf(child)}" — ${this.state(child)}. It gave its answer before (pispark_look shows what it last said).` };
      if (!(await this.sessions.arrival(owner, signal))) return undefined;
    }
  }

  // ---- Up: what a parent hears ------------------------------------------------------------------

  /**
   * A session notes or raises, to whoever asked it. From a child: a note is a line in its parent's
   * conversation, without a turn; a raise wakes the parent, and the child is owed an answer. From a
   * session the person started, both are for the person, in its own conversation.
   */
  async up(sessionId: string, word: "raise" | "note", text: string, data?: unknown): Promise<Answer> {
    const session = this.sessions.get(sessionId);
    const parent = this.parentOf(session.metadata);
    // Kept for whoever looks at the session: a child's last note, and what anyone raised until it is answered.
    if (parent || word === "raise") session.up(word, text);
    const child = session.metadata;
    if (!parent) return { ok: true, text: word === "raise" ? "Raised with the person." : "Noted for the person." };
    const title = titleOf(child);
    const handle = this.handles.of(parent.id, this.name, child.id);
    const attached = data !== undefined ? { data } : {};
    if (word === "note") {
      await this.note(parent, { word, from: { id: handle, kind: "session", title }, text, ...attached }, child.id);
      return { ok: true, text: `Noted for "${titleOf(parent)}".` };
    }
    const heading = `The session "${title}" (${handle}) you started raises this, and waits for your answer (pispark_send):\n\n`;
    void this.sessions.deliver(parent.id, {
      source: { kind: "session", id: child.id, label: `${title} · raised` },
      text: `${heading}${text}`,
      card: { title, how: "raised", start: heading.length },
      due: this.due(),
      policy: "queue",
      word: "raise",
      report: { title, how: "raised", text, ...attached },
      ...(child.collect ? { collect: true as const } : {}),
    });
    return { ok: true, text: `Raised with "${titleOf(parent)}". Its answer arrives here as a message: carry on with what does not depend on it, or finish your turn to wait.` };
  }

  /**
   * The person stops a session. For a child whose ask is open, that is what its parent's stop
   * does (its run and what it started), and its parent gets a note of it. Nothing for any other
   * session: the caller stops its run as usual, at once.
   */
  stoppedByPerson(sessionId: string): Promise<void> | undefined {
    let child: SessionMetadata;
    try {
      child = this.sessions.storage.read(sessionId);
    } catch {
      return undefined;
    }
    if (!this.parentOf(child) || !child.ask) return undefined;
    this.sessions.stopProcesses(sessionId);
    return (async () => {
      await this.sessions.ensure(sessionId);
      const session = this.sessions.get(sessionId);
      if (session.settled) this.answer(session, { outcome: "cancelled", by: "person" });
      else await session.cancel();
    })();
  }

  /**
   * The person said something to a session. If it is a child still working on what its parent
   * asked, that changes the parent's work, so the parent gets a note of it. A child at rest is
   * simply asked by the person: its answer is theirs, and the parent is told nothing.
   */
  told(sessionId: string, text: string): void {
    const child = this.sessions.storage.read(sessionId);
    const parent = this.parentOf(child);
    if (!parent || !child.ask) return;
    const title = titleOf(child);
    const line = `The person told the session "${title}" (${this.handles.of(parent.id, this.name, child.id)}): ${text}`;
    void this.line(parent, line, { session: child.id, title, how: `was told by you: ${short(text)}` }).catch((error: unknown) => this.failed(parent.id, error));
  }

  /**
   * A child's run ended. Its parent hears once per ask, not once per run: when the child is at
   * rest (nothing it started is still due to wake it, and nothing it raised waits for an answer),
   * or at once when it was stopped or failed, since it will not get there by itself. A run nobody
   * asked for (the person's, a late wake's) tells the parent nothing.
   */
  ended(session: Session, result: RunResult): void {
    if (!session.metadata.ask) return;
    if (result.outcome === "completed" && this.owed(session.metadata)) return;
    this.answer(session, result);
  }

  /** Something a session waited for is settled without a run of its own: a child may be at rest now. */
  async rested(sessionId: string): Promise<void> {
    try {
      const child = this.sessions.storage.read(sessionId);
      if (!child.ask || this.owed(child) || !this.sessions.accepting()) return;
      await this.sessions.ensure(sessionId);
      const session = this.sessions.get(sessionId);
      if (session.metadata.ask && session.settled && !this.owed(session.metadata)) this.answer(session, { outcome: "completed" });
    } catch (error) {
      this.failed(sessionId, error);
    }
  }

  /** The child's answer to its open ask goes to its parent, and the ask is closed. */
  private answer(session: Session, result: RunResult): void {
    // Everything it said since it was asked, so a summary given before its last process ended is not lost.
    const ended = result.outcome === "completed" ? "answered" : result.outcome === "failed" ? "failed" : "stopped";
    const said = session.closeAsk({ state: ended, ...(result.by === "person" ? { detail: "by you" } : {}) }).join("\n\n");
    const child = session.metadata;
    const parent = this.parentOf(child);
    if (!parent || !this.sessions.accepting()) return;
    const title = titleOf(child);
    const how = result.outcome === "completed" ? "finished" : result.outcome === "cancelled" ? "stopped" : "failed";
    const body = said ? cut(said) : `It ${how} without an answer.`;
    const data = session.resultData;
    const report: Report = { title, how, text: body, ...(data !== undefined ? { data } : {}) };
    const answer = {
      source: { kind: "session" as const, id: child.id, label: `${title} · ${how}` },
      due: this.due(),
      policy: "queue" as const,
      word: "answer" as const,
      report,
      ...(child.collect ? { collect: true as const } : {}),
    };
    const handle = this.handles.of(parent.id, this.name, child.id);
    // The person stopped it: its parent gets a note of that, not a turn. It is still the answer to the ask, so a wait takes it.
    if (result.by === "person")
      return void this.sessions.deliver(parent.id, {
        ...answer,
        report: { ...report, how: "stopped by the person" },
        text: `The person stopped the session "${title}" (${handle}).`,
        card: { title, how: "was stopped by you", start: 0 },
        quiet: true,
      });
    // A run the clock asked for, not the parent's agent: a line, so a schedule does not cost the parent a turn each time.
    if (child.schedule) return void this.sessions.deliver(parent.id, { ...answer, text: `The session "${title}" you started ${how}.`, card: { title, how, start: 0 }, quiet: true });
    // The line the agent needs; the card says it already, so it shows the answer after it.
    const heading = `The session "${title}" (${handle}) you started ${how}:\n\n`;
    void this.sessions.deliver(parent.id, { ...answer, text: `${heading}${body}${dataText(data, 56 * 1024 - body.length)}`, card: { title, how, start: heading.length } });
  }

  /** A child's note reaches its parent: the parent's extensions hear it first, then it is a line, unless they took it. */
  private async note(parent: SessionMetadata, note: Omit<Heard, "reply">, childId: string): Promise<void> {
    if (parent.archived) return;
    await this.sessions.ensure(parent.id);
    const heard = this.sessions.get(parent.id).hear(note);
    if (heard?.action === "skip") return;
    const text = heard?.text ?? note.text;
    await this.line(parent, `"${note.from.title}" (${note.from.id}) notes: ${text}`, { session: childId, title: note.from.title, how: `notes: ${short(text)}` });
  }

  /** A line in a parent's conversation, without a turn: its agent reads it the next time it runs. */
  private async line(parent: SessionMetadata, text: string, details: StatusDetails): Promise<void> {
    if (parent.archived) return;
    await this.sessions.ensure(parent.id);
    await this.sessions.get(parent.id).addStatus(text, details);
  }

  // ---- Reading ----------------------------------------------------------------------------------

  private readonly gone: Answer = { ok: false, text: "This session did not start a session with that id (pispark_look lists what it started)." };

  private child(owner: string, id: string): SessionMetadata | undefined {
    return this.under(owner).find((each) => each.id === id);
  }

  /** It is owed something: a message due to wake it, a process still running, or an answer to what it raised. */
  private owed(child: SessionMetadata): boolean {
    return !!child.raise || this.sessions.pending(child.id);
  }

  /** Where a child's ask stands, for whoever looks at it: its parent's views, and (in words) its parent's agent. */
  stand(child: SessionMetadata): Ask {
    const session = this.sessions.live(child.id);
    const note = child.note ? { note: child.note } : {};
    if (session?.asking) return { state: "waiting", detail: "for you, in it", ...note };
    if (session && !session.settled) return { state: "working", ...note };
    if (child.raise) return { state: "asked", question: child.raise, ...note };
    const due = child.ask ? this.sessions.waitingFor(child.id) : undefined;
    if (due) return { state: "waiting", detail: due, ...note };
    if (session?.status === "error" || child.interrupted) return { state: "failed", ...note };
    return { ...(child.ended ?? { state: "answered" }), ...note };
  }

  private state(child: SessionMetadata): string {
    if (child.archived) return "archived";
    const { state, detail } = this.stand(child);
    if (state === "waiting") return this.sessions.live(child.id)?.asking ? "waiting for the person" : `waiting ${detail}`;
    if (state === "stopped") return detail === "by you" ? "stopped by the person" : "stopped";
    return { working: "working", asked: "waiting for your answer", answered: "at rest", failed: "failed" }[state];
  }

  private due(): string {
    return new Date(this.sessions.now()).toISOString();
  }

  /** What a parent's message to its child says about where it came from. */
  private from(parent: SessionMetadata): WokenDetails {
    return { source: { kind: "session", id: parent.id, label: titleOf(parent) }, due: this.due() };
  }

  /** The parent of a child, while it can be told something: listed and itself not a child. */
  private parentOf(child: SessionMetadata): SessionMetadata | undefined {
    if (!child.parent) return undefined;
    try {
      const parent = this.sessions.storage.read(child.parent);
      return parent.parent === undefined ? parent : undefined;
    } catch {
      return undefined;
    }
  }

  private failed(sessionId: string, error: unknown): void {
    this.sessions.logger.event("wake.failure", { sessionId, outcome: "failed", code: runtimeError(error, "execution").code });
  }
}
