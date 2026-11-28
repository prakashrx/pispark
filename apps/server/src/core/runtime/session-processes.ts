import { isAbsolute, join } from "node:path";
import type { ProcessInfo, ProcessList, ProcessOutput } from "../../contract/process-protocol.js";
import type { Answer, Verb } from "../../contract/verbs.js";
import type { StatusDetails } from "../../contract/wake-protocol.js";
import type { Processes, ProcessEnd } from "./processes.js";
import type { Handles } from "./handles.js";
import type { Kind, Listed, Taken } from "./started.js";
import { RuntimeError } from "./errors.js";
import { validateId, type SessionMetadata } from "./storage.js";
import type { SessionAccess } from "./session-access.js";

type Stored = ReturnType<Processes["get"]>;

/**
 * Background processes as one kind of thing a session can start: starting one, looking at it,
 * stopping it, waiting for it and changing what it raises on; what its session hears when it ends
 * or a line of its output is raised; and what clients list, read and stop. `Processes` runs them.
 */
export class SessionProcesses implements Kind {
  readonly name = "process";

  constructor(
    private readonly sessions: SessionAccess,
    private readonly processes: Processes,
    private readonly handles: Handles,
  ) {}

  // ---- What its session does to it ---------------------------------------------------------------

  /** Runs a command in the background. Returns at once, with its first second of output. */
  async start(owner: string, request: Omit<Extract<Verb, { verb: "start_process" }>, "verb">, signal?: AbortSignal): Promise<Answer> {
    const { cwd } = this.sessions.storage.read(owner);
    const folder = request.folder ? (isAbsolute(request.folder) ? request.folder : join(cwd, request.folder)) : cwd;
    const started = this.processes.start(owner, {
      command: request.command,
      folder,
      ...(request.title ? { title: request.title } : {}),
      ...(request.raise_on ? { raiseOn: request.raise_on } : {}),
      ...(request.stop_after_seconds ? { stopAfterSeconds: request.stop_after_seconds } : {}),
      ...(request.collect ? { collect: true } : {}),
    });
    this.sessions.live(owner)?.changed();
    const process = this.processes.get(started.id, [owner]);
    await this.processes.wait(process, undefined, 0, 1000, signal);
    // Its first output is shown but stays unread: a wait or a look after the start begins at the beginning.
    const first = this.processes.tail(process).trim() || "(no output yet)";
    const handle = this.handles.of(owner, this.name, started.id);
    return {
      ok: true,
      text: `Started ${handle}: ${this.describe(process)} in ${folder}.\n${first}`,
      details: { id: started.id },
      data: { id: handle },
    };
  }

  of(owner: string): Listed[] {
    // Open while it runs, or while its end still waits to be taken: one that ended while nobody looked has its answer to give.
    return this.processes.list(owner).map((p) => ({
      id: p.id,
      line: this.describe(p),
      open: p.state === "running" || (!this.processes.endTaken(p.id) && this.sessions.waiting(owner, p.id)),
    }));
  }

  async look(owner: string, id: string, find?: string): Promise<Answer> {
    const process = this.processes.get(id, [owner]);
    if (find === undefined) return { ok: true, text: `${this.describe(process)}\n${this.unread(process)}` };
    // Searching an ended process's output is reading it after it ended: its end is taken.
    this.processes.takeEnd(process.id);
    return { ok: true, text: `${this.describe(process)}\n${this.processes.search(process, find)}` };
  }

  async stop(owner: string, id: string, signal?: AbortSignal): Promise<Answer> {
    const process = this.processes.get(id, [owner]);
    if (process.state !== "running") return { ok: true, text: "It is not running." };
    this.processes.stop(process.id, "agent");
    await this.processes.waitForExit(process, 5000, signal);
    return {
      ok: true,
      text: process.state === "running" ? "Stopping; it has not ended yet (pispark_look shows when it has)." : "Stopped.",
    };
  }

  /** A process cannot think, so PiSpark speaks for it: the only thing to tell it is what to raise on. */
  async send(owner: string, id: string, { raise_on }: { raise_on?: string }): Promise<Answer> {
    if (raise_on === undefined) return { ok: false, text: "A process cannot be sent text; give raise_on to change what it raises on." };
    this.processes.raiseOn(this.processes.get(id, [owner]), raise_on || undefined);
    return {
      ok: true,
      text: raise_on
        ? `It raises when a line of its output matches /${raise_on}/, at most once a minute.`
        : "It no longer raises on its output.",
    };
  }

  async wait(owner: string, id: string, until: RegExp | undefined, signal: AbortSignal): Promise<Taken | undefined> {
    const process = this.processes.get(id, [owner]);
    const result = until
      ? await this.processes.wait(process, until, process.cursors[owner] ?? 0, undefined, signal)
      : await this.processes.waitForExit(process, undefined, signal);
    if (result === "timeout") return undefined;
    // Its end is its answer, the same one its session would be sent: taken here, so it is not sent.
    if (result === "ended") {
      this.processes.takeEnd(process.id);
      const tail = this.processes.tail(process).trim();
      const how = `${process.ended ?? process.state}${process.exitCode !== undefined ? ` ${process.exitCode}` : ""}`;
      return {
        words: `${this.describe(process)}\n${until ? "It ended before the output showed that.\n" : ""}Last output:\n${tail || "(none)"}`,
        how,
        text: tail,
      };
    }
    // What follows the line it waited for (a server's URL after "ready") usually comes at once:
    // a moment more of output, until it goes quiet for a quarter second, at most half a second.
    for (const end = Date.now() + 500; Date.now() < end; ) {
      const before = process.written;
      await new Promise((done) => setTimeout(done, 250));
      if (process.written === before) break;
    }
    const unread = this.unread(process);
    return { words: `${this.describe(process)}\nThe output shows ${until}.\n${unread}`, how: "matched", text: unread };
  }

  // ---- What its session hears --------------------------------------------------------------------

  /** A process ended, or a line of its output is raised: its session is woken. One the person stopped is only noted. */
  ended(sessionId: string, end: ProcessEnd): void {
    this.sessions.live(sessionId)?.changed();
    if (!this.sessions.accepting()) return;
    let metadata: SessionMetadata;
    try {
      metadata = this.sessions.storage.read(sessionId);
    } catch {
      return;
    }
    if (metadata.archived) return;
    const title = end.process.title ?? end.process.command;
    const short = title.length > 80 ? `${title.slice(0, 79)}…` : title;
    const handle = this.handles.of(sessionId, this.name, end.process.id);
    if (end.by === "person") {
      void this.line(sessionId, `The person stopped the process "${short}" (${handle}).`, {
        process: end.process.id,
        title: short,
        how: "was stopped by you",
        ok: false,
      }).catch(() => {});
      return;
    }
    // The lines the agent needs; the card says them already, so it shows the output after them.
    const heading = `The process "${short}" (${handle}) ${end.how}${end.raised ? `:\n${end.raised}` : "."}\n\nLast output:\n`;
    void this.sessions.deliver(sessionId, {
      source: { kind: "process", id: end.process.id, label: `${short} · ${end.how}`.slice(0, 200) },
      text: `${heading}${end.tail.trim() || "(none)"}`,
      card: { title: short, how: end.how.slice(0, 200), start: heading.length },
      due: new Date(this.sessions.now()).toISOString(),
      policy: "queue",
      word: end.raised ? "raise" : "answer",
      report: { title: short, how: end.how.slice(0, 200), text: end.raised ?? end.tail },
      ...(end.process.collect ? { collect: true as const } : {}),
    });
  }

  // ---- For clients -------------------------------------------------------------------------------

  /** A session's processes. */
  list(sessionId: string): ProcessInfo[] {
    validateId(sessionId);
    this.sessions.storage.read(sessionId);
    return this.processes.list(sessionId);
  }

  /** Every process still running, with its session's title. */
  running(): ProcessList {
    return {
      processes: this.processes.running().map((p) => {
        let title: string | undefined;
        try {
          title = this.sessions.storage.read(p.sessionId).title;
        } catch {
          /* Its session is gone. */
        }
        return { ...p, session: title ? { title } : {} };
      }),
    };
  }

  output(sessionId: string, id: string, since: number): ProcessOutput {
    validateId(sessionId);
    if (!Number.isSafeInteger(since) || since < 0) throw new RuntimeError("invalid-input");
    return this.processes.read(this.processes.get(id, [sessionId]), since);
  }

  /** The person stops a process; its session gets a note of it. */
  stopByPerson(sessionId: string, id: string): void {
    validateId(sessionId);
    this.processes.stop(this.processes.get(id, [sessionId]).id, "person");
  }

  // ---- Reading -----------------------------------------------------------------------------------

  private describe(p: ProcessInfo): string {
    return `${p.title ? `${p.title} (${p.command})` : p.command} — ${
      p.state === "running"
        ? `running since ${p.startedAt}`
        : `${p.ended ? p.ended.replace("-", " ") : p.state}${p.exitCode !== undefined ? ` (exit ${p.exitCode})` : ""}`
    }`;
  }
  /** What its session has not read yet. Reading an ended process's output takes its end, so it is not told again. */
  private unread(process: Stored): string {
    const out = this.processes.unread(process, process.sessionId);
    return `${out.cut ? "(older output was cut)\n" : ""}${out.text.trim() ? out.text : "(no new output)"}`;
  }

  /** A line in a session's conversation, without a turn, loading it if needed. */
  private async line(sessionId: string, text: string, details: StatusDetails): Promise<void> {
    await this.sessions.ensure(sessionId);
    await this.sessions.get(sessionId).addStatus(text, details);
  }
}
