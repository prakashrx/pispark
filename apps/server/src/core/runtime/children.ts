import type { Answer, ChildEnded, Verb } from "../../contract/verbs.js";
import type { StatusDetails, WokenDetails } from "../../contract/wake-protocol.js";
import { bindingOf } from "../agents/resolve.js";
import { validAgentId } from "../agents/format.js";
import { validateText, type RunResult, type Session } from "./session.js";
import { toolSessionTitle } from "./session-title.js";
import { runtimeError } from "./errors.js";
import type { Handles } from "./handles.js";
import type { Kind, Listed } from "./started.js";
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

type Report = Omit<ChildEnded, "reply">;
/** Whether a message waiting for a parent is a child's raise, not its answer. */
const raised = (wake: Wake) => wake.report?.how === "raised";

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
   * A session started by another one: in the parent's folder (or its agent's own), with the
   * parent's agent and model unless another agent is named, and the brief as its first message.
   */
  async start(owner: string, request: Omit<Extract<Verb, { verb: "start_session" }>, "verb">): Promise<Answer> {
    const parent = this.sessions.storage.read(owner);
    if (parent.parent) return { ok: false, text: "A session started by another session cannot start sessions." };
    const { agents } = this.sessions;
    const agent = request.agent ?? parent.agent;
    if (!validAgentId(agent) || !agents.exists({ agent })) return { ok: false, text: `There is no agent "${agent}".` };
    let ownFolder: boolean;
    try {
      ownFolder = !!bindingOf(agents, { agent }).folder;
    } catch {
      return { ok: false, text: `The agent "${agent}" cannot be used now.` };
    }
    validateText(request.brief);
    let title: string | undefined;
    try {
      title = request.title ? toolSessionTitle(request.title) : undefined;
    } catch {
      /* Named from its first message instead. */
    }
    const doc = await this.sessions.create(
      { ...(ownFolder ? {} : { folder: parent.cwd }), agent, ...(agent === parent.agent && parent.model ? { model: parent.model } : {}) },
      { parent: parent.id, ...(title ? { title } : {}) },
    );
    const session = this.sessions.get(doc.id);
    void session.start(request.brief, this.from(parent)).completion.catch(() => {});
    return {
      ok: true,
      text: `Started "${titleOf(session.metadata)}" (${this.handles.of(owner, this.name, doc.id)}). It works on its own; its answer arrives here as a message when it is done.`,
      details: { id: doc.id },
    };
  }

  of(owner: string): Listed[] {
    return this.under(owner).map((child) => ({ id: child.id, line: `"${titleOf(child)}" — ${this.state(child)}`, open: !!child.ask && !child.archived }));
  }

  async look(owner: string, id: string): Promise<Answer> {
    const child = this.child(owner, id);
    if (!child) return this.gone;
    const lines = [`"${titleOf(child)}" — ${this.state(child)}`];
    if (child.raise) lines.push(`It raised: ${child.raise}`);
    if (child.note) lines.push(`Its last note: ${child.note}`);
    // An answer still waiting to be sent here is taken by looking: it is shown now, and not sent.
    const answers = this.sessions.take(owner, child.id, (wake) => !raised(wake));
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
    this.sessions.get(child.id).closeAsk();
    this.sessions.take(owner, child.id);
    this.sessions.stopProcesses(child.id);
    if (working) await this.sessions.cancel(child.id);
    return { ok: true, text: "Stopped." };
  }

  /**
   * Its parent tells it something. A child at rest is asked anew, and answers once more. A working
   * one reads it at its next pause (`now`) or when it has finished what it is doing (`after`).
   */
  async send(owner: string, id: string, { text, when }: { text?: string; when?: "now" | "after" }): Promise<Answer> {
    const child = this.child(owner, id);
    if (!child) return this.gone;
    if (text === undefined) return { ok: false, text: "A session is sent text; raise_on is for a process." };
    if (child.archived) return { ok: false, text: "That session is archived." };
    this.sessions.admit();
    await this.sessions.ensure(child.id);
    validateText(text);
    const session = this.sessions.get(child.id);
    // Telling it something answers what it raised: a raise still waiting to be sent here is not sent.
    this.sessions.take(owner, child.id, raised);
    try {
      if (session.settled) {
        session.openAsk();
        void session.start(text, this.from(this.sessions.storage.read(owner))).completion.catch(() => {});
        return { ok: true, text: "Sent. Its answer arrives here as a message when it is done." };
      }
      await session.queue(text, when === "after" ? "follow-up" : "steer");
      return { ok: true, text: when === "after" ? "Sent. It reads this when it has finished what it is doing." : "Sent. It reads this at its next pause." };
    } catch (error) {
      if (runtimeError(error, "execution").code === "busy") return { ok: false, text: "It cannot take a message right now; try again in a moment." };
      throw error;
    }
  }

  // ---- Up: what a parent hears ------------------------------------------------------------------

  /**
   * A session notes or raises, to whoever asked it. From a child: a note is a line in its parent's
   * conversation, without a turn; a raise wakes the parent, and the child is owed an answer. From a
   * session the person started, both are for the person, in its own conversation.
   */
  async up(sessionId: string, word: "raise" | "note", text: string): Promise<Answer> {
    const session = this.sessions.get(sessionId);
    const parent = this.parentOf(session.metadata);
    // Kept for whoever looks at the session: a child's last note, and what anyone raised until it is answered.
    if (parent || word === "raise") session.up(word, text);
    const child = session.metadata;
    if (!parent) return { ok: true, text: word === "raise" ? "Raised with the person." : "Noted for the person." };
    const title = titleOf(child);
    const handle = this.handles.of(parent.id, this.name, child.id);
    if (word === "note") {
      await this.line(parent, `"${title}" (${handle}) notes: ${text}`, { session: child.id, title, how: `notes: ${short(text)}` });
      return { ok: true, text: `Noted for "${titleOf(parent)}".` };
    }
    const heading = `The session "${title}" (${handle}) you started raises this, and waits for your answer (pispark_send):\n\n`;
    void this.sessions.deliver(parent.id, {
      source: { kind: "session", id: child.id, label: `${title} · raised` },
      text: `${heading}${text}`,
      card: { title, how: "raised", start: heading.length },
      due: this.due(),
      policy: "queue",
      report: { session: child.id, title, how: "raised", text },
    });
    return { ok: true, text: `Raised with "${titleOf(parent)}". Its answer arrives here as a message: carry on with what does not depend on it, or finish your turn to wait.` };
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
    const said = session.closeAsk().join("\n\n");
    const child = session.metadata;
    const parent = this.parentOf(child);
    if (!parent || !this.sessions.accepting()) return;
    const title = titleOf(child);
    const how = result.outcome === "completed" ? "finished" : result.outcome === "cancelled" ? "stopped" : "failed";
    const body = said ? cut(said) : `It ${how} without an answer.`;
    const data = session.resultData;
    const report: Report = { session: child.id, title, how, text: body, ...(data !== undefined ? { data } : {}) };
    // A run the clock asked for, not the parent's agent: a line, so a schedule does not cost the parent a turn each time.
    if (child.schedule) return void this.scheduled(parent, report).catch((error: unknown) => this.failed(parent.id, error));
    // The line the agent needs; the card says it already, so it shows the answer after it.
    const heading = `The session "${title}" (${this.handles.of(parent.id, this.name, child.id)}) you started ${how}:\n\n`;
    void this.sessions.deliver(parent.id, {
      source: { kind: "session", id: child.id, label: `${title} · ${how}` },
      text: `${heading}${body}${dataText(data, 56 * 1024 - body.length)}`,
      card: { title, how, start: heading.length },
      due: this.due(),
      policy: "queue",
      report,
    });
  }

  /** A scheduled run ended: the parent's extensions see it first and may take it or turn it into a message that wakes the agent. */
  private async scheduled(parent: SessionMetadata, report: Report): Promise<void> {
    if (parent.archived) return;
    await this.sessions.ensure(parent.id);
    const answer = this.sessions.get(parent.id).offerChildEnded(report);
    if (answer?.action === "skip") return;
    if (answer?.action === "send")
      return this.sessions.deliver(parent.id, {
        source: { kind: "session", id: report.session, label: `${report.title} · ${report.how}` },
        text: answer.text,
        card: { title: report.title, how: report.how, start: 0 },
        due: this.due(),
        policy: "queue",
      });
    await this.line(parent, `The session "${report.title}" you started ${report.how}.`, { session: report.session, title: report.title, how: report.how, ok: report.how === "finished" });
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

  private state(child: SessionMetadata): string {
    if (child.archived) return "archived";
    const session = this.sessions.live(child.id);
    if (session?.asking) return "waiting for the person";
    if (session && !session.settled) return "working";
    if (child.raise) return "waiting for your answer";
    if (child.ask && this.sessions.pending(child.id)) return "waiting for what it started";
    if (session?.status === "error" || child.interrupted) return "failed";
    return "at rest";
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
