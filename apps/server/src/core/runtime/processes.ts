import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { appendFile, open, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { UUID } from "../../contract/ids.js";
import type { ProcessInfo, ProcessOutput } from "../../contract/process-protocol.js";
import { silentLogger, type SafeLogger } from "../logger.js";
import { replaceLater, writeAtomic } from "../files.js";
import { RuntimeError } from "./errors.js";
import { pattern } from "./verbs.js";

/** The newest output kept per process; when the log grows past it, it is cut to `KEEP`. */
const MAX_LOG = 2 * 1024 * 1024;
const KEEP = 1024 * 1024;
/** A process raises a line of its output at most this often. */
const RAISE_EVERY_MS = 60_000;
/** Ended processes kept per session, with their output; older ones go as new ones start. */
const KEPT_ENDED = 20;

/** How a process ended, for its session: the process, how it reads, and its last output. */
export interface ProcessEnd {
  process: ProcessInfo;
  how: string;
  /** It ended as it should (exited 0), or not; absent when a line was raised, which is neither. */
  ok?: boolean;
  tail: string;
  /** The person stopped it. */
  by?: "person";
  /** The line that matched `raiseOn` (the process still runs), rather than the process ending. */
  raised?: string;
}

/** What the processes need from the runtime. */
export interface ProcessHost {
  /** The session folders there are, read at start. */
  ids(): string[];
  directory(sessionId: string): string;
  /** A process ended (or a line of its output is raised): tell its session. */
  tell(sessionId: string, end: ProcessEnd): void;
}

/** A process as `processes.json` keeps it: what clients see, plus where its log starts and who read how far. */
interface Stored extends ProcessInfo {
  /** Output bytes cut from the start of the log. */
  offset: number;
  /** How far each session last read (`output` without `since`). */
  cursors: Record<string, number>;
  /** Its end was not told yet (PiSpark stopped while it ran). */
  untold?: true;
  /** Its end has been taken: its session was told, read it, waited for it, or stopped it. It is not told again. */
  taken?: true;
}
/**
 * A running process's log on disk. Output is appended in order without holding up the server, and
 * `written` counts only what is on disk, so a reader never asks for bytes that aren't there yet.
 * Past `MAX_LOG` it is cut to its newest `KEEP` bytes, in the same queue.
 */
class Log {
  private queue: Buffer[] = [];
  private flushing?: Promise<void>;
  constructor(
    private readonly path: string,
    private readonly record: Stored,
    /** Bytes just put on disk: for `raiseOn` and anyone waiting on output. */
    private readonly wrote: (data: Buffer) => void,
  ) {}
  add(chunk: Buffer): void {
    this.queue.push(chunk);
    this.flushing ??= this.flush().finally(() => (this.flushing = undefined));
  }
  /** Resolves once everything added so far is on disk. */
  idle(): Promise<void> {
    return this.flushing ?? Promise.resolve();
  }
  private async flush(): Promise<void> {
    while (this.queue.length) {
      // Whatever came while the last write ran goes as one write.
      const data = Buffer.concat(this.queue.splice(0));
      try {
        await appendFile(this.path, data);
      } catch {
        continue; // A full disk loses output, not the process.
      }
      this.record.written += data.length;
      if (this.record.written - this.record.offset > MAX_LOG) await this.cut();
      this.wrote(data);
    }
  }
  /** Keeps the newest `KEEP` bytes. A reader sees the whole old log until the cut one replaces it. */
  private async cut(): Promise<void> {
    const temporary = `${this.path}.cut`;
    try {
      const size = this.record.written - this.record.offset;
      const keep = Buffer.alloc(Math.min(KEEP, size));
      const file = await open(this.path, "r");
      try {
        await file.read(keep, 0, keep.length, size - keep.length);
      } finally {
        await file.close();
      }
      await writeFile(temporary, keep, { mode: 0o600 });
      await replaceLater(temporary, this.path);
      this.record.offset = this.record.written - keep.length;
    } catch {
      // Kept whole for now; cut on the next write.
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
}

interface Live {
  child: ChildProcess;
  log: Log;
  /** `raiseOn` compiled, once for each pattern it is given. */
  raise?: { source: string; regex?: RegExp };
  /** The line being written, for `raiseOn`. */
  partial: string;
  waiters: Set<() => void>;
  /** When it last raised a line. */
  raisedAt: number;
  stoppedBy?: "agent" | "person" | "timeout" | "pispark";
  /** Where the shell wrote its process group (Git Bash). */
  group?: string;
  timer?: ReturnType<typeof setTimeout>;
}

const view = (s: Stored): ProcessInfo => {
  const { offset: _offset, cursors: _cursors, untold: _untold, taken: _taken, ...info } = s;
  return structuredClone(info);
};
const clean = (text: string) => text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\x1b\[[0-9;?]*[A-Za-z]/g, "");

/**
 * Processes sessions started: commands that run on this host beside the session, owned here so they
 * keep running while their session unloads. Output goes to `sessions/<id>/processes/<pid>.log`; the
 * list to `sessions/<id>/processes.json`. A process ends by itself, by Stop, after its own time limit,
 * or when PiSpark stops; its session is told (after a restart, for that last case).
 */
export class Processes {
  private readonly stored = new Map<string, Stored[]>();
  private readonly live = new Map<string, Live>();
  private closed = false;

  constructor(
    private readonly host: ProcessHost,
    private readonly options: { logger?: SafeLogger } = {},
  ) {}

  private get logger(): SafeLogger {
    return this.options.logger ?? silentLogger;
  }

  /** Reads every session's processes; any still marked running ended when PiSpark stopped. */
  load(): void {
    for (const id of this.host.ids()) {
      const path = join(this.host.directory(id), "processes.json");
      if (!existsSync(path)) continue;
      try {
        const file = JSON.parse(readFileSync(path, "utf8")) as { version?: number; processes?: Stored[] };
        if (file.version !== 1 || !Array.isArray(file.processes)) throw new Error();
        const list = file.processes.filter((p) => p && typeof p.id === "string" && UUID.test(p.id) && typeof p.command === "string");
        for (const p of list) {
          // What older versions kept: how it reported, and its watches.
          for (const old of ["report", "watches"]) delete (p as unknown as Record<string, unknown>)[old];
          if (p.state === "running") Object.assign(p, { state: "stopped", ended: "pispark-stopped", endedAt: new Date().toISOString(), untold: true });
        }
        this.stored.set(id, list);
        this.save(id);
      } catch {
        this.logger.event("wake.unreadable", { sessionId: id, outcome: "failed", code: "storage" });
      }
    }
  }
  /** Tells sessions about processes that ended while PiSpark was stopped. */
  announce(): void {
    for (const [sessionId, list] of this.stored)
      for (const p of list.filter((p) => p.untold)) {
        delete p.untold;
        this.save(sessionId);
        this.host.tell(sessionId, { process: view(p), how: "ended when PiSpark stopped", ok: false, tail: this.tail(p) });
      }
  }
  /** PiSpark stops: every process is stopped (waited for, up to a few seconds); each session is told after the next start. */
  async shutdown(): Promise<void> {
    this.closed = true;
    for (const [id, live] of this.live) {
      live.stoppedBy = "pispark";
      const p = this.find(id);
      if (p) Object.assign(p.process, { state: "stopped", ended: "pispark-stopped", endedAt: new Date().toISOString(), untold: true });
      if (p) this.save(p.sessionId);
      this.kill(live.child, live.group);
    }
    await Promise.race([Promise.allSettled([...this.kills]), new Promise((done) => setTimeout(done, 5000).unref())]);
  }
  /** Kills still finishing, so shutdown can wait for them. */
  private readonly kills = new Set<Promise<void>>();
  private kill(child: ChildProcess, group?: string): void {
    const done = killTree(child, group).finally(() => this.kills.delete(done));
    this.kills.add(done);
  }

  // ---- Starting and stopping ------------------------------------------------------------------

  start(sessionId: string, input: { command: string; folder: string; title?: string; raiseOn?: string; stopAfterSeconds?: number; collect?: boolean }): ProcessInfo {
    if (this.closed) throw new RuntimeError("closed");
    if (typeof input.command !== "string" || !input.command.trim() || input.command.length > 8192) throw new RuntimeError("invalid-input");
    if (!existsSync(input.folder) || !statSync(input.folder).isDirectory()) throw new RuntimeError("folder");
    const id = randomUUID();
    const dir = join(this.host.directory(sessionId), "processes");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, `${id}.log`), "", { mode: 0o600 });
    const { shell, args, commandTransport } = getShellConfig();
    // Under Git Bash, the shell first writes its MSYS process id, which is also the group everything
    // it starts belongs to, so Stop can find them all (see `descendants`).
    const group = join(dir, `${id}.group`);
    const command = gitBash(shell) ? `echo $$ > ${quote(group.replace(/\\/g, "/"))}; ${input.command}` : input.command;
    const stdin = commandTransport === "stdin";
    const child = spawn(shell, stdin ? args : [...args, command], {
      cwd: input.folder,
      env: process.env,
      windowsHide: true,
      // Its own process group off Windows, so Stop ends everything it started.
      detached: process.platform !== "win32",
      stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"],
    });
    if (stdin) child.stdin?.end(command);
    const record: Stored = {
      id,
      sessionId,
      command: input.command,
      folder: input.folder,
      ...(input.title ? { title: input.title.slice(0, 120) } : {}),
      startedAt: new Date().toISOString(),
      state: "running",
      ...(input.raiseOn ? { raiseOn: input.raiseOn } : {}),
      ...(input.collect ? { collect: true as const } : {}),
      written: 0,
      offset: 0,
      cursors: {},
    };
    this.stored.set(sessionId, [...this.pruned(sessionId), record]);
    const log = new Log(join(dir, `${id}.log`), record, (data) => this.output(record, live, data));
    const live: Live = { child, log, partial: "", waiters: new Set(), raisedAt: 0, group };
    this.live.set(id, live);
    const output = (chunk: Buffer) => log.add(chunk);
    child.stdout?.on("data", output);
    child.stderr?.on("data", output);
    // It has ended once its last output is on disk, so whoever is told reads all of it.
    child.on("error", () => void log.idle().then(() => this.ended(record, live, null)));
    child.on("close", (code) => void log.idle().then(() => this.ended(record, live, code)));
    if (input.stopAfterSeconds)
      live.timer = setTimeout(() => this.stop(id, "timeout"), Math.min(input.stopAfterSeconds, 7 * 86_400) * 1000).unref();
    this.save(sessionId);
    return view(record);
  }
  /**
   * A session's processes, keeping the newest ended ones: older ones go with their logs, as runs and
   * wake records keep only the newest.
   */
  private pruned(sessionId: string): Stored[] {
    const list = this.stored.get(sessionId) ?? [];
    const ended = list.filter((p) => p.state !== "running" && !p.untold);
    const drop = new Set(ended.slice(0, Math.max(0, ended.length - KEPT_ENDED)).map((p) => p.id));
    for (const id of drop)
      for (const file of [`${id}.log`, `${id}.group`])
        try {
          unlinkSync(join(this.host.directory(sessionId), "processes", file));
        } catch {
          /* Already gone. */
        }
    return list.filter((p) => !drop.has(p.id));
  }
  /** Stops a process and everything it started. */
  stop(id: string, by: "agent" | "person" | "timeout"): void {
    const live = this.live.get(id);
    if (!live) return;
    live.stoppedBy ??= by;
    this.kill(live.child, live.group);
  }
  /** The session goes away (archived or deleted): its processes stop, quietly. */
  stopSession(sessionId: string): void {
    for (const p of this.stored.get(sessionId) ?? []) if (this.live.has(p.id)) this.stop(p.id, "agent");
  }
  forget(sessionId: string): void {
    this.stopSession(sessionId);
    this.stored.delete(sessionId);
  }

  /** Output just put on its log: a line `raiseOn` matches is told, and whoever waits on output looks again. */
  private output(record: Stored, live: Live, chunk: Buffer): void {
    // `raiseOn` looks at whole lines.
    const lines = (live.partial + clean(chunk.toString("utf8"))).split("\n");
    live.partial = lines.pop() ?? "";
    if (live.partial.length > 8192) live.partial = live.partial.slice(-8192);
    if (record.raiseOn && live.raise?.source !== record.raiseOn) live.raise = { source: record.raiseOn, regex: pattern(record.raiseOn) };
    const raiseOn = record.raiseOn && Date.now() - live.raisedAt >= RAISE_EVERY_MS ? live.raise?.regex : undefined;
    const line = raiseOn && lines.find((each) => raiseOn.test(each));
    if (line) {
      live.raisedAt = Date.now();
      this.host.tell(record.sessionId, { process: view(record), how: `printed a line matching ${record.raiseOn}`, tail: this.tail(record), raised: line.slice(0, 500) });
    }
    for (const wake of live.waiters) wake();
  }
  private ended(record: Stored, live: Live, code: number | null): void {
    if (!this.live.delete(record.id)) return;
    if (live.timer) clearTimeout(live.timer);
    const stoppedBy = live.stoppedBy;
    const ended = stoppedBy === "pispark" ? "pispark-stopped" : stoppedBy === "timeout" ? "timeout" : stoppedBy ? "stopped" : undefined;
    Object.assign(record, {
      state: ended ? "stopped" : code === 0 ? "exited" : "failed",
      endedAt: new Date().toISOString(),
      ...(code !== null ? { exitCode: code } : {}),
      ...(ended ? { ended } : {}),
      // Whoever stopped it knows it ended.
      ...(stoppedBy === "agent" || stoppedBy === "person" ? { taken: true as const } : {}),
    });
    this.save(record.sessionId);
    for (const wake of live.waiters) wake();
    // Stopped by the agent, or by PiSpark stopping (told after the restart): nothing to tell now.
    if (stoppedBy === "agent" || stoppedBy === "pispark" || this.closed) return;
    const how =
      stoppedBy === "person" ? "was stopped" : stoppedBy === "timeout" ? "was stopped at its time limit" : code === 0 ? "exited 0" : code === null ? "could not start" : `exited ${code}`;
    this.host.tell(record.sessionId, { process: view(record), how, ok: stoppedBy === undefined && code === 0, tail: this.tail(record), ...(stoppedBy === "person" ? { by: stoppedBy } : {}) });
  }

  // ---- Reading ----------------------------------------------------------------------------------

  private find(id: string): { sessionId: string; process: Stored } | undefined {
    for (const [sessionId, list] of this.stored) {
      const process = list.find((p) => p.id === id);
      if (process) return { sessionId, process };
    }
    return undefined;
  }
  /** One process, if `sessions` may see it (its own, or a child's). */
  get(id: string, sessions: string[]): Stored {
    const found = typeof id === "string" ? this.find(id) : undefined;
    if (!found || !sessions.includes(found.sessionId)) throw new RuntimeError("not-found");
    return found.process;
  }
  list(sessionId: string): ProcessInfo[] {
    return (this.stored.get(sessionId) ?? []).map(view);
  }
  /** Every process still running, across sessions. */
  running(): ProcessInfo[] {
    return [...this.stored.values()].flatMap((list) => list.filter((p) => p.state === "running").map(view));
  }
  runningIn(sessionId: string): number {
    return (this.stored.get(sessionId) ?? []).filter((p) => p.state === "running").length;
  }
  /** Output after `since` (bytes), at most `max` bytes from there. */
  read(process: Stored, since: number, max = 64 * 1024): ProcessOutput {
    const log = join(this.host.directory(process.sessionId), "processes", `${process.id}.log`);
    const start = Math.max(since, process.offset);
    const length = Math.max(0, Math.min(process.written - start, max));
    const buffer = Buffer.alloc(length);
    if (length)
      try {
        const fd = openSync(log, "r");
        try {
          readSync(fd, buffer, 0, length, start - process.offset);
        } finally {
          closeSync(fd);
        }
      } catch {
        /* Gone with its session. */
      }
    return { text: clean(buffer.toString("utf8")), next: start + length, ...(since < process.offset ? { cut: true as const } : {}) };
  }
  /** Literal, case-insensitive search over the retained log. No unread cursor is involved. */
  search(process: Stored, query: string): string {
    const out = this.read(process, 0, MAX_LOG);
    const lines = out.text.split(/\r?\n/);
    const literal = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
    const selected = new Map<number, number>();
    let matches = 0;
    for (let i = 0; i < lines.length; i++) {
      const at = lines[i]!.search(literal);
      if (at < 0) continue;
      if (++matches > 5) break;
      if (i > 0 && !selected.has(i - 1)) selected.set(i - 1, -1);
      selected.set(i, at);
      if (i + 1 < lines.length) selected.set(i + 1, -1);
    }
    const excerpt = [...selected].map(([i, at]) => {
      const line = lines[i]!;
      const start = Math.max(0, at - 80);
      const end = start + 320;
      return `${at >= 0 ? ">" : " "} ${i + 1}: ${start ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
    });
    return [
      out.cut ? "Older output was discarded; line numbers are relative to the retained log." : "",
      excerpt.length ? excerpt.join("\n") : "No match in the retained log.",
      matches > 5 ? "Showing the first 5 matching lines; more matches exist." : "",
    ].filter(Boolean).join("\n");
  }
  /** The last `bytes` of output. */
  tail(process: Stored, bytes = 4096): string {
    return this.read(process, Math.max(0, process.written - bytes)).text;
  }
  /** What a session has not read yet (or the tail, the first time), moving its cursor. */
  unread(process: Stored, reader: string, max = 16 * 1024): ProcessOutput {
    const since = process.cursors[reader] ?? Math.max(0, process.written - max);
    const out = this.read(process, since, max);
    process.cursors[reader] = out.next;
    if (reader !== process.sessionId || !this.takeEnd(process.id)) this.save(process.sessionId);
    return out;
  }
  /** Its session has the process's end now (it read it, waited for it or was told). False when there was nothing to take. */
  takeEnd(id: string): boolean {
    const process = this.find(id)?.process;
    if (!process || process.taken || process.state === "running") return false;
    process.taken = true;
    this.save(process.sessionId);
    return true;
  }
  /** Whether its end has been taken already. */
  endTaken(id: string): boolean {
    return this.find(id)?.process.taken === true;
  }
  /**
   * Waits until output after `since` matches `pattern` (or any output, without one), the process
   * ends, the time (if any) is up or `signal` aborts.
   */
  async wait(process: Stored, pattern: RegExp | undefined, since: number, timeoutMs: number | undefined, signal?: AbortSignal): Promise<"matched" | "ended" | "timeout"> {
    // Only what came since the last look is read, with a little before it so a match split
    // across two chunks is still seen.
    let from = since;
    const matched = () => {
      const out = this.read(process, Math.max(since, from - 1024), MAX_LOG);
      from = out.next;
      return pattern ? pattern.test(out.text) : out.next > since;
    };
    if (matched()) return "matched";
    return this.waitUntilEnd(process, timeoutMs, signal, matched);
  }

  /** Wait for terminal state, without inspecting output or moving a reader's cursor. */
  waitForExit(process: Stored, timeoutMs: number | undefined, signal?: AbortSignal): Promise<"ended" | "timeout"> {
    return this.waitUntilEnd(process, timeoutMs, signal);
  }

  private waitUntilEnd(process: Stored, timeoutMs: number | undefined, signal?: AbortSignal): Promise<"ended" | "timeout">;
  private waitUntilEnd(process: Stored, timeoutMs: number | undefined, signal: AbortSignal | undefined, matched: () => boolean): Promise<"matched" | "ended" | "timeout">;
  private async waitUntilEnd(process: Stored, timeoutMs: number | undefined, signal?: AbortSignal, matched?: () => boolean): Promise<"matched" | "ended" | "timeout"> {
    const live = this.live.get(process.id);
    if (!live) return "ended";
    if (signal?.aborted) return "timeout";
    return new Promise((resolve) => {
      const done = (result: "matched" | "ended" | "timeout") => {
        clearTimeout(timer);
        live.waiters.delete(check);
        signal?.removeEventListener("abort", aborted);
        resolve(result);
      };
      const check = () => (matched?.() ? done("matched") : !this.live.has(process.id) ? done("ended") : undefined);
      const aborted = () => done("timeout");
      const timer = timeoutMs === undefined ? undefined : setTimeout(() => done("timeout"), timeoutMs);
      live.waiters.add(check);
      signal?.addEventListener("abort", aborted, { once: true });
    });
  }
  /** Changes what it raises on; nothing, when left out. */
  raiseOn(process: Stored, source: string | undefined): void {
    if (source !== undefined && (source.length > 200 || !pattern(source))) throw new RuntimeError("invalid-input");
    if (source === undefined) delete process.raiseOn;
    else process.raiseOn = source;
    this.save(process.sessionId);
  }

  private save(sessionId: string): void {
    const directory = this.host.directory(sessionId);
    if (!existsSync(directory)) return;
    try {
      writeAtomic(join(directory, "processes.json"), JSON.stringify({ version: 1, processes: this.stored.get(sessionId) ?? [] }, null, 2) + "\n");
    } catch {
      this.logger.event("wake.failure", { sessionId, outcome: "failed", code: "storage" });
    }
  }
}

/** A Windows program by its full path, so a different one on PATH is never run. */
const system32 = (program: string) => join(process.env.SystemRoot || "C:\\Windows", "System32", program);
/** One argument for a POSIX shell. */
const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/** Whether the shell is Git Bash (MSYS), whose processes `ps -W` lists with their Windows ids. */
const gitBash = (shell: string) => process.platform === "win32" && /[\\/]git[\\/]/i.test(shell);

/**
 * Git for Windows' `ps.exe` for a Git Bash path: `<git>\\bin\\bash.exe` (the launcher) or
 * `<git>\\usr\\bin\\bash.exe` (MSYS's own, first on PATH inside Git Bash). Undefined for any other bash.
 */
export function gitPs(shell: string): string | undefined {
  if (process.platform !== "win32") return;
  const parts = shell.split(/[\\/]/);
  const git = parts.findLastIndex((part) => part.toLowerCase() === "git");
  if (git < 0) return;
  const ps = join(parts.slice(0, git + 1).join("\\"), "usr", "bin", "ps.exe");
  return existsSync(ps) ? ps : undefined;
}

/**
 * Runs a program and gives back its standard output: empty if it cannot run, and what it printed so
 * far if it has not finished within `timeoutMs` (it is then ended). Stop must never wait on a helper
 * that stalls (Windows' process service can, on a fresh machine).
 */
function output(command: string, args: string[], timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve) => {
    const run = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let text = "";
    const timer = setTimeout(() => {
      run.kill();
      resolve(text);
    }, timeoutMs);
    timer.unref();
    run.stdout.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
    run.on("error", () => (clearTimeout(timer), resolve("")));
    run.on("close", () => (clearTimeout(timer), resolve(text)));
  });
}
/**
 * Windows: every process under `root`. The Windows parent links come from one snapshot of the
 * process table. Git Bash breaks them where it runs a script (`npm` is one): MSYS starts the new
 * process under a short-lived parent that then exits. MSYS keeps the real tree, and its process group
 * covers everything the command started, so Git's `ps -W` (with each process's Windows id) adds the
 * rest; their native children are then found by the Windows links again.
 */
async function descendants(root: number, groupFile?: string): Promise<number[]> {
  const children = new Map<number, number[]>();
  const table = await output(system32("WindowsPowerShell\\v1.0\\powershell.exe"), [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
  ]);
  for (const line of table.split(/\r?\n/)) {
    const [id, parent] = line.trim().split(/\s+/).map(Number);
    if (!id || parent === undefined || Number.isNaN(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const found = new Set<number>();
  const visit = (id: number) => {
    for (const each of children.get(id) ?? []) {
      if (found.has(each) || found.size > 512) continue;
      found.add(each);
      visit(each);
    }
  };
  visit(root);
  const ps = gitPs(getShellConfig().shell);
  if (ps) {
    // PID PPID PGID WINPID ...: MSYS processes have a group; native ones show 0.
    const rows = (await output(ps, ["-W"]))
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/).slice(0, 4).map(Number))
      .filter((row) => row.length === 4 && row.every((n) => !Number.isNaN(n)));
    const ours = new Set([root, ...found]);
    const groups = new Set(rows.filter(([, , group, winpid]) => group! > 0 && ours.has(winpid!)).map(([, , group]) => group!));
    // The group the shell wrote down covers it even after it replaced itself (`exec`, or a script).
    try {
      const written = Number(readFileSync(groupFile ?? "", "utf8").trim());
      if (Number.isSafeInteger(written) && written > 0) groups.add(written);
    } catch {
      /* Not written (yet), or not Git Bash. */
    }
    for (const [, , group, winpid] of rows)
      if (groups.has(group!) && !ours.has(winpid!)) {
        found.add(winpid!);
        visit(winpid!);
      }
  }
  found.delete(root);
  return [...found];
}

/** Ends a process and everything it started; resolves once it is done (or gone). */
async function killTree(child: ChildProcess, groupFile?: string): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  const closed = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>((done) => child.once("close", () => done()));
  if (process.platform === "win32") {
    // Git Bash's launcher can exit and leave its children (bash, npm, node) without a parent, out of
    // reach of `taskkill /T`. So the whole tree is found first, then every process in it is ended.
    const pids = [pid, ...(await descendants(pid, groupFile))];
    await new Promise<void>((done) => {
      const taskkill = spawn(system32("taskkill.exe"), ["/F", "/T", ...pids.flatMap((each) => ["/PID", String(each)])], { windowsHide: true, stdio: "ignore" });
      taskkill.on("error", () => (child.kill(), done()));
      taskkill.on("close", () => done());
    });
    await Promise.race([closed, new Promise((done) => setTimeout(done, 5000).unref())]);
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const force = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* Already gone. */
    }
  }, 3000);
  force.unref();
  await closed;
  clearTimeout(force);
}
