import { isAbsolute, join } from "node:path";
import type { ProcessInfo, ProcessList, ProcessOutput } from "../../contract/process-protocol.js";
import type { StatusDetails } from "../../contract/wake-protocol.js";
import type { Processes, ProcessEnd } from "./processes.js";
import type { ProcessRequest } from "./process-tool.js";
import { RuntimeError } from "./errors.js";
import { validateId, type SessionMetadata } from "./storage.js";
import { titleOf, type SessionAccess } from "./session-access.js";

type Stored = ReturnType<Processes["get"]>;

/**
 * Background processes as sessions see them: the process tool's requests, what a session hears when
 * one ends or a watch matches, and what clients list, read and stop. A session sees its own processes
 * and its children's. `Processes` runs them.
 */
export class SessionProcesses {
  constructor(
    private readonly sessions: SessionAccess,
    private readonly processes: Processes,
    /** The sessions this one started. */
    private readonly children: (id: string) => SessionMetadata[],
  ) {}

  /** The process tool's requests (the agent's, or an extension's in that session). */
  async request(sessionId: string, request: ProcessRequest, signal?: AbortSignal): Promise<{ ok: boolean; text: string }> {
    const { storage } = this.sessions;
    const processes = this.processes;
    const metadata = storage.read(sessionId);
    const describe = (p: ProcessInfo) =>
      `${p.id}: ${p.title ? `${p.title} (${p.command})` : p.command} — ${
        p.state === "running" ? `running since ${p.startedAt}` : `${p.ended ? p.ended.replace("-", " ") : p.state}${p.exitCode !== undefined ? ` (exit ${p.exitCode})` : ""}`
      }${p.sessionId !== sessionId ? ` [started by ${titleOf(storage.read(p.sessionId))}]` : ""}`;
    const waited = async (process: Stored, wait: { waitFor?: string; timeoutSeconds?: number }, since: number) => {
      if (wait.waitFor === undefined) return "";
      let pattern: RegExp;
      try {
        pattern = new RegExp(wait.waitFor, "i");
      } catch {
        throw new RuntimeError("invalid-input");
      }
      const result = await processes.wait(process, pattern, since, wait.timeoutSeconds! * 1000, signal);
      // What follows the line it waited for (a server's URL after "ready") usually comes at once:
      // a moment more of output, until it goes quiet for a quarter second, at most half a second.
      if (result === "matched")
        for (const end = Date.now() + 500; Date.now() < end; ) {
          const before = process.written;
          await new Promise((done) => setTimeout(done, 250));
          if (process.written === before) break;
        }
      return { matched: `The output shows /${wait.waitFor}/.`, ended: "It ended before the output showed that.", timeout: `Not seen within ${wait.timeoutSeconds} s.` }[result] + "\n";
    };
    const output = (process: Stored) => {
      const out = processes.unread(process, sessionId);
      return `${out.cut ? "(older output was cut)\n" : ""}${out.text.trim() ? out.text : "(no new output)"}`;
    };
    const visible = () => this.visibleTo(sessionId);
    switch (request.action) {
      case "start": {
        const folder = request.folder ? (isAbsolute(request.folder) ? request.folder : join(metadata.cwd, request.folder)) : metadata.cwd;
        const started = processes.start(sessionId, {
          command: request.command,
          folder,
          ...(request.title ? { title: request.title } : {}),
          report: request.report ?? "result",
          ...(request.stopAfterSeconds ? { stopAfterSeconds: request.stopAfterSeconds } : {}),
        });
        this.sessions.live(sessionId)?.changed();
        const process = processes.get(started.id, [sessionId]);
        // Its first output, or what it was asked to wait for.
        const note = request.waitFor !== undefined ? await waited(process, request, 0) : (await processes.wait(process, undefined, 0, 1000, signal), "");
        return { ok: true, text: `Started ${describe(processes.get(started.id, [sessionId]))} in ${folder}.\n${note}${output(process)}` };
      }
      case "list": {
        const all = visible().flatMap((id) => processes.list(id));
        return { ok: true, text: all.length ? all.map(describe).join("\n") : "No processes." };
      }
      case "output": {
        const process = processes.get(request.id, visible());
        const note = await waited(process, request, process.cursors[sessionId] ?? process.written);
        return { ok: true, text: `${describe(process)}\n${note}${output(process)}` };
      }
      case "wait": {
        const process = processes.get(request.id, visible());
        const result = await processes.waitForExit(process, request.timeoutSeconds * 1000, signal);
        const note = result === "timeout" ? (signal?.aborted ? " (wait cancelled)" : " (wait timed out)") : "";
        const state = process.ended ?? process.state;
        const exit = process.exitCode === undefined ? "" : ` (exit ${process.exitCode})`;
        return { ok: true, text: `${process.id}: ${state}${exit}${note}` };
      }
      case "search": {
        const process = processes.get(request.id, visible());
        return { ok: true, text: processes.search(process, request.query) };
      }
      case "watch":
      case "unwatch": {
        const process = processes.get(request.id, visible());
        processes.watch(process, request.pattern, request.action === "unwatch" ? "remove" : (request.report ?? "result"));
        return { ok: true, text: request.action === "watch" ? `Watching for /${request.pattern}/; at most one wake a minute.` : "No longer watching that." };
      }
      case "stop": {
        const process = processes.get(request.id, visible());
        if (process.state !== "running") return { ok: true, text: "It is not running." };
        processes.stop(process.id, "agent");
        await processes.waitForExit(process, 5000, signal);
        if (processes.get(process.id, [process.sessionId]).state === "running") return { ok: true, text: "Stopping; it has not ended yet (list shows when it has)." };
        return { ok: true, text: "Stopped." };
      }
    }
  }

  /** A process ended (or a watch matched): its session is told as the mode says. */
  ended(sessionId: string, end: ProcessEnd): void {
    this.sessions.live(sessionId)?.changed();
    if (end.mode === "none" || !this.sessions.accepting()) return;
    let metadata: SessionMetadata;
    try {
      metadata = this.sessions.storage.read(sessionId);
    } catch {
      return;
    }
    if (metadata.archived) return;
    const title = end.process.title ?? end.process.command;
    const short = title.length > 80 ? `${title.slice(0, 79)}…` : title;
    if (end.mode === "status") {
      void this.statusIn(sessionId, `The process "${short}" ${end.how}.`, { process: end.process.id, title: short, how: end.how, ...(end.ok !== undefined ? { ok: end.ok } : {}) }).catch(() => {});
      return;
    }
    void this.sessions.deliver(sessionId, {
      source: { kind: "process", id: end.process.id, label: `${short} · ${end.how}`.slice(0, 200) },
      text: `The process "${short}" ${end.how}${end.watch ? `:\n${end.watch}` : "."}\n\nLast output:\n${end.tail.trim() || "(none)"}`,
      due: new Date(this.sessions.now()).toISOString(),
      policy: "queue",
    });
  }

  /** A session's processes, for clients. */
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

  /** The person stops a process; its session is told. */
  stop(sessionId: string, id: string): void {
    validateId(sessionId);
    this.processes.stop(this.processes.get(id, [sessionId]).id, "person");
  }

  /** The sessions whose processes a session may see: its own and its children's. */
  private visibleTo(sessionId: string): string[] {
    return [sessionId, ...this.children(sessionId).map((child) => child.id)];
  }

  /** A status line in a session's conversation, loading it if needed. */
  private async statusIn(sessionId: string, text: string, details: StatusDetails): Promise<void> {
    await this.sessions.ensure(sessionId);
    await this.sessions.get(sessionId).addStatus(text, details);
  }
}
