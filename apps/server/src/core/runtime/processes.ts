import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import type { ProcessInfo, ProcessOutput } from "../../contract/process-protocol.js";
import { validReportMode, type ReportMode } from "../../contract/wake-protocol.js";
import { silentLogger, type SafeLogger } from "../logger.js";
import { writeAtomic } from "../personas/store.js";
import { RuntimeError } from "./errors.js";

/** The newest output kept per process; when the log grows past it, it is cut to `KEEP`. */
const MAX_LOG = 2 * 1024 * 1024;
const KEEP = 1024 * 1024;
/** A watch wakes its session at most this often. */
const WATCH_EVERY_MS = 60_000;
/** Ended processes kept per session, with their output; older ones go as new ones start. */
const KEPT_ENDED = 20;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** How a process ended, for its session: the process, how it reads, and its last output. */
export interface ProcessEnd {
  process: ProcessInfo;
  how: string;
  tail: string;
  mode: ReportMode;
  /** A watch matched (the process still runs), rather than the process ending. */
  watch?: string;
}

/** What the processes need from the runtime. */
export interface ProcessHost {
  /** The session folders there are, read at start. */
  ids(): string[];
  directory(sessionId: string): string;
  /** A process ended (or a watch matched): tell its session as `mode` says. */
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
}
interface Live {
  child: ChildProcess;
  /** The line being written, for watches. */
  partial: string;
  waiters: Set<() => void>;
  lastWatch: Map<string, number>;
  stoppedBy?: "agent" | "person" | "timeout" | "pispark";
  /** Where the shell wrote its process group (Git Bash). */
  group?: string;
  timer?: ReturnType<typeof setTimeout>;
}

const view = (s: Stored): ProcessInfo => {
  const { offset: _offset, cursors: _cursors, untold: _untold, ...info } = s;
  return structuredClone(info);
};
const clean = (text: string) => text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\x1b\[[0-9;?]*[A-Za-z]/g, "");

/**
 * Processes sessions started: commands that run on this host beside the session, owned here so they
 * keep running while their session unloads. Output goes to `chats/<id>/processes/<pid>.log`; the
 * list to `chats/<id>/processes.json`. A process ends by itself, by Stop, after its own time limit,
 * or when PiSpark stops; its session is told as its mode says (after a restart, for that last case).
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
        for (const p of list)
          if (p.state === "running") Object.assign(p, { state: "stopped", ended: "pispark-stopped", endedAt: new Date().toISOString(), untold: true });
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
        this.host.tell(sessionId, { process: view(p), how: "ended when PiSpark stopped", tail: this.tail(p), mode: p.report });
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

  start(sessionId: string, input: { command: string; folder: string; title?: string; report: ReportMode; stopAfterSeconds?: number }): ProcessInfo {
    if (this.closed) throw new RuntimeError("closed");
    if (typeof input.command !== "string" || !input.command.trim() || input.command.length > 8192) throw new RuntimeError("invalid-input");
    if (!validReportMode(input.report)) throw new RuntimeError("invalid-input");
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
      report: input.report,
      watches: [],
      written: 0,
      offset: 0,
      cursors: {},
    };
    this.stored.set(sessionId, [...this.pruned(sessionId), record]);
    const live: Live = { child, partial: "", waiters: new Set(), lastWatch: new Map(), group };
    this.live.set(id, live);
    const output = (chunk: Buffer) => this.output(record, live, chunk);
    child.stdout?.on("data", output);
    child.stderr?.on("data", output);
    child.on("error", () => this.ended(record, live, null));
    child.on("close", (code) => this.ended(record, live, code));
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

  private output(record: Stored, live: Live, chunk: Buffer): void {
    const dir = join(this.host.directory(record.sessionId), "processes");
    const log = join(dir, `${record.id}.log`);
    try {
      appendFileSync(log, chunk);
      record.written += chunk.length;
      if (record.written - record.offset > MAX_LOG) {
        const size = statSync(log).size;
        const keep = Buffer.alloc(Math.min(KEEP, size));
        const fd = openSync(log, "r");
        try {
          readSync(fd, keep, 0, keep.length, size - keep.length);
        } finally {
          closeSync(fd);
        }
        writeFileSync(log, keep);
        record.offset = record.written - keep.length;
      }
    } catch {
      /* A full disk loses output, not the process. */
    }
    // Watches look at whole lines.
    const lines = (live.partial + clean(chunk.toString("utf8"))).split("\n");
    live.partial = lines.pop() ?? "";
    if (live.partial.length > 8192) live.partial = live.partial.slice(-8192);
    for (const watch of record.watches) {
      const last = live.lastWatch.get(watch.pattern) ?? 0;
      if (Date.now() - last < WATCH_EVERY_MS) continue;
      let pattern: RegExp;
      try {
        pattern = new RegExp(watch.pattern, "i");
      } catch {
        continue;
      }
      const line = lines.find((each) => pattern.test(each));
      if (!line) continue;
      live.lastWatch.set(watch.pattern, Date.now());
      this.host.tell(record.sessionId, { process: view(record), how: `printed a line matching ${watch.pattern}`, tail: this.tail(record), mode: watch.report, watch: line.slice(0, 500) });
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
    });
    this.save(record.sessionId);
    for (const wake of live.waiters) wake();
    // Stopped by the agent, or by PiSpark stopping (told after the restart): nothing to tell now.
    if (stoppedBy === "agent" || stoppedBy === "pispark" || this.closed) return;
    const how =
      stoppedBy === "person" ? "was stopped" : stoppedBy === "timeout" ? "was stopped at its time limit" : code === 0 ? "exited 0" : code === null ? "could not start" : `exited ${code}`;
    this.host.tell(record.sessionId, { process: view(record), how, tail: this.tail(record), mode: record.report });
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
  /** The last `bytes` of output. */
  tail(process: Stored, bytes = 4096): string {
    return this.read(process, Math.max(0, process.written - bytes)).text;
  }
  /** What a session has not read yet (or the tail, the first time), moving its cursor. */
  unread(process: Stored, reader: string, max = 16 * 1024): ProcessOutput {
    const since = process.cursors[reader] ?? Math.max(0, process.written - max);
    const out = this.read(process, since, max);
    process.cursors[reader] = out.next;
    this.save(process.sessionId);
    return out;
  }
  /**
   * Waits until output after `since` matches `pattern` (or any output, without one), the process
   * ends, the time is up or `signal` aborts. Never without a time limit.
   */
  async wait(process: Stored, pattern: RegExp | undefined, since: number, timeoutMs: number, signal?: AbortSignal): Promise<"matched" | "ended" | "timeout"> {
    const live = this.live.get(process.id);
    // Only what came since the last look is read, with a little before it so a match split
    // across two chunks is still seen.
    let from = since;
    const matched = () => {
      const out = this.read(process, Math.max(since, from - 1024), MAX_LOG);
      from = out.next;
      return pattern ? pattern.test(out.text) : out.next > since;
    };
    if (matched()) return "matched";
    if (!live) return "ended";
    return new Promise((resolve) => {
      const done = (result: "matched" | "ended" | "timeout") => {
        clearTimeout(timer);
        live.waiters.delete(check);
        signal?.removeEventListener("abort", aborted);
        resolve(result);
      };
      const check = () => (matched() ? done("matched") : !this.live.has(process.id) ? done("ended") : undefined);
      const aborted = () => done("timeout");
      const timer = setTimeout(() => done("timeout"), timeoutMs);
      live.waiters.add(check);
      signal?.addEventListener("abort", aborted, { once: true });
    });
  }
  /** Adds (or with `report` "none" and `remove`, drops) a watch. */
  watch(process: Stored, pattern: string, report: ReportMode | "remove"): void {
    try {
      new RegExp(pattern, "i");
    } catch {
      throw new RuntimeError("invalid-input");
    }
    if (pattern.length > 200) throw new RuntimeError("invalid-input");
    process.watches = process.watches.filter((w) => w.pattern !== pattern);
    if (report !== "remove") process.watches.push({ pattern, report });
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

/** Runs a program and gives back its standard output (empty if it cannot run). */
function output(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const run = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let text = "";
    run.stdout.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
    run.on("error", () => resolve(""));
    run.on("close", () => resolve(text));
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
  const { shell } = getShellConfig();
  const ps = join(dirname(dirname(shell)), "usr", "bin", "ps.exe");
  if (/[\\/]git[\\/]/i.test(shell) && existsSync(ps)) {
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
