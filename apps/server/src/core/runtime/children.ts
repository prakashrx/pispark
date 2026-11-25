import type { WokenDetails } from "../../contract/wake-protocol.js";
import { bindingOf } from "../agents/resolve.js";
import { validAgentId } from "../agents/format.js";
import { validateText, type RunResult, type Session } from "./session.js";
import { toolSessionTitle } from "./session-title.js";
import type { SessionRequest, ToolAnswer } from "./session-tool.js";
import { runtimeError } from "./errors.js";
import type { SessionMetadata } from "./storage.js";
import type { Wake } from "./wakes.js";
import { titleOf, type SessionAccess } from "./session-access.js";

/** A child's result data as the parent's agent reads it, if it fits in `room` characters. */
function dataText(data: unknown, room: number): string {
  if (data === undefined) return "";
  for (const text of [JSON.stringify(data, null, 2), JSON.stringify(data)])
    if (text.length + 16 <= room) return `\n\nIts data:\n${text}`;
  return "\n\n(It also set data, too large to show here; this session's extensions received it.)";
}

/**
 * Sessions started by other sessions: the session tool's requests, and what a parent hears when its
 * child ends or raises something. One level only: a child cannot start sessions.
 */
export class Children {
  constructor(private readonly sessions: SessionAccess) {}

  /** The sessions this one started. */
  of(id: string): SessionMetadata[] {
    return this.sessions.storage.list().filter((metadata) => metadata.parent === id);
  }

  /** The session tool's requests (the agent's, or an extension's in that session): its own children only. */
  async request(parentId: string, request: SessionRequest): Promise<ToolAnswer> {
    const { storage, admit, ensure, get, live, cancel } = this.sessions;
    const parent = storage.read(parentId);
    if (request.action === "inspect" || request.action === "reload") return { ok: false, text: "The calling session handles this itself." };
    if (request.action === "report") return this.raise(parent, request.text);
    if (request.action === "start") return this.start(parent, request);
    if (request.action === "list") {
      const children = this.of(parentId);
      if (!children.length) return { ok: true, text: "This session has not started any sessions." };
      return { ok: true, text: children.map((child) => `${child.id}: ${titleOf(child)} (${this.state(child)})`).join("\n") };
    }
    const child = this.of(parentId).find((each) => each.id === request.id);
    if (!child) return { ok: false, text: "This session did not start a session with that id (list shows them)." };
    if (request.action === "read") {
      if (child.archived) return { ok: false, text: "That session is archived." };
      await ensure(child.id);
      const session = get(child.id);
      if (request.runId === undefined) return { ok: true, text: session.lastReply() ?? "It has not answered yet." };
      const result = session.childRunResult(request.runId);
      if (!result) return { ok: false, text: "No such completed run for that child session." };
      const status = result.outcome === "failed" ? `failed${result.error ? ` (${result.error})` : ""}` : result.outcome === "cancelled" ? "stopped" : "finished";
      const body = `Run ${request.runId} ${status}.\n\n${result.answer ?? "No answer for this run."}`;
      return { ok: true, text: body + dataText(result.data, 56 * 1024 - body.length) };
    }
    if (request.action === "stop") {
      const session = live(child.id);
      if (!session || session.settled) return { ok: true, text: "It is not working." };
      await cancel(child.id);
      return { ok: true, text: "Stopped." };
    }
    if (child.archived) return { ok: false, text: "That session is archived." };
    admit();
    await ensure(child.id);
    validateText(request.text);
    try {
      void get(child.id).start(request.text, this.from(parent)).completion.catch(() => {});
    } catch (error) {
      if (runtimeError(error, "execution").code === "busy") return { ok: false, text: "It is still working; its answer will come back here." };
      throw error;
    }
    return { ok: true, text: "Sent." };
  }

  /** A child's run ended: its parent is told as the child's mode says. */
  ended(session: Session, result: RunResult): void {
    const mode = session.metadata.report ?? "result";
    const parent = this.parentOf(session.metadata);
    if (!parent || mode === "none" || !this.sessions.accepting()) return;
    const title = titleOf(session.metadata);
    const how = result.outcome === "completed" ? "finished" : result.outcome === "cancelled" ? "stopped" : "failed";
    const exact = result.childResult;
    const answer = mode === "notice" ? exact?.answer : result.outcome === "completed" ? session.lastReply() : undefined;
    const body = answer ? (answer.length > 8192 ? `${answer.slice(0, 8192)}…\n(cut; read shows all of it)` : answer) : `It ${how} without an answer.`;
    const data = mode === "notice" ? exact?.data : session.resultData;
    const report = { session: session.id, title, how, mode, text: body, ...(exact ? { runId: exact.id } : {}), ...(data !== undefined ? { data } : {}) };
    if (mode === "status")
      return void this.statusLine(parent, report).catch((error: unknown) => {
        this.sessions.logger.event("wake.failure", { sessionId: parent.id, outcome: "failed", code: runtimeError(error, "execution").code });
      });
    // The line the agent needs; the card says it already, so it shows the report after it.
    const heading = `The session "${title}" you started ${how}:\n\n`;
    void this.sessions.deliver(parent.id, {
      source: { kind: "session", id: session.id, label: `${title} · ${how}` },
      text: mode === "notice"
        ? exact
          ? `The session "${title}" you started ${how} (run_id: ${exact.id}). To fetch this result, use pispark_session read with id ${session.id} and run_id ${exact.id}.`
          : `The session "${title}" you started ${how}${result.error ? ` (${result.error})` : ""}. No run result was saved.`
        : `${heading}${body}${dataText(data, 56 * 1024 - body.length)}`,
      card: { title, how, start: mode === "notice" ? 0 : heading.length },
      due: this.due(),
      policy: "queue",
      report,
    });
  }

  private due(): string {
    return new Date(this.sessions.now()).toISOString();
  }

  /** What a parent's message to its child says about where it came from. */
  private from(parent: SessionMetadata): WokenDetails {
    return { source: { kind: "session", id: parent.id, label: titleOf(parent) }, due: this.due() };
  }

  private state(child: SessionMetadata): string {
    if (child.archived) return "archived";
    const session = this.sessions.live(child.id);
    if (session?.asking) return "waiting for the person";
    if (session && !session.settled) return "working";
    if (session?.status === "error" || child.interrupted) return "failed";
    return "finished";
  }

  /**
   * A session started by another one: in the parent's folder (or its agent's own), with the
   * parent's agent and model unless another agent is named, and the parent's message first.
   */
  private async start(parent: SessionMetadata, request: Extract<SessionRequest, { action: "start" }>) {
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
    validateText(request.prompt);
    let title: string | undefined;
    try {
      title = request.title ? toolSessionTitle(request.title) : undefined;
    } catch {
      /* Named from its first message instead. */
    }
    const report = request.report ?? "result";
    const doc = await this.sessions.create(
      { ...(ownFolder ? {} : { folder: parent.cwd }), agent, ...(agent === parent.agent && parent.model ? { model: parent.model } : {}) },
      { parent: parent.id, ...(report !== "result" ? { report } : {}), ...(title ? { title } : {}) },
    );
    const session = this.sessions.get(doc.id);
    void session.start(request.prompt, this.from(parent)).completion.catch(() => {});
    const how = {
      result: "its answer arrives here as a message when it finishes.",
      notice: "a short notice arrives with a run_id to read its exact result.",
      status: "a line here says when it ends, and it raises anything that needs you.",
      none: "it does not report back (read shows its answer).",
    }[report];
    return { ok: true, text: `Started "${titleOf(session.metadata)}" (id ${doc.id}). It works on its own; ${how}`, details: { id: doc.id } };
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

  /**
   * Status mode: a line in the parent's conversation, without a turn. Its extensions see the end
   * first and may take it (no line) or turn it into a message that wakes the agent.
   */
  private async statusLine(parent: SessionMetadata, report: NonNullable<Wake["report"]>): Promise<void> {
    if (parent.archived) return;
    await this.sessions.ensure(parent.id);
    const session = this.sessions.get(parent.id);
    const answer = session.offerChildEnded(report);
    if (answer?.action === "skip") return;
    if (answer?.action === "send")
      return this.sessions.deliver(parent.id, {
        source: { kind: "session", id: report.session, label: `${report.title} · ${report.how}` },
        text: answer.text,
        card: { title: report.title, how: report.how, start: 0 },
        due: this.due(),
        policy: "queue",
      });
    await session.addStatus(`The session "${report.title}" you started ${report.how}.`, { session: report.session, title: report.title, how: report.how, ok: report.how === "finished" });
  }

  /** A child in status mode raises something: its text wakes its parent, whose extensions see it first. */
  private raise(child: SessionMetadata, text: string): { ok: boolean; text: string } {
    const parent = this.parentOf(child);
    if (!parent || child.report !== "status") return { ok: false, text: "Only a session started by another one, in status mode, can raise things with it." };
    const title = titleOf(child);
    const heading = `The session "${title}" you started raises this:\n\n`;
    void this.sessions.deliver(parent.id, {
      source: { kind: "session", id: child.id, label: `${title} · raised` },
      text: `${heading}${text}`,
      card: { title, how: "raised", start: heading.length },
      due: this.due(),
      policy: "queue",
      report: { session: child.id, title, how: "raised", mode: "status", text },
    });
    return { ok: true, text: "Raised with the session that started this one." };
  }
}
