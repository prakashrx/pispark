import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LauncherMessage, ServerMessage } from "../../server/src/contract/host-protocol.ts";
import { windows, type Release } from "./install.ts";

export type ServerState = "starting" | "running" | "stopping" | "stopped" | "crashed";

export interface SupervisorOptions {
  port: number;
  home?: string;
  /** The server's output goes here (the newest 5 MB, then one older file). */
  logFile: string;
  onMessage: (message: ServerMessage) => void;
  onState: (state: ServerState) => void;
  /** Called once the server is up, to send it the launcher's state. */
  onReady: () => void;
}

const QUICK_CRASHES = 5;
const CRASH_WINDOW_MS = 120_000;

/**
 * Runs the server as a child: starts it, waits until it answers, restarts it after a crash (and
 * gives up after five quick crashes), and stops it gracefully over the IPC channel.
 */
export class Supervisor {
  private child?: ChildProcess;
  private crashes: number[] = [];
  private restartTimer?: NodeJS.Timeout;
  private wanted = false;
  private release?: Release;
  state: ServerState = "stopped";
  /** How the server last ended on its own (a crash), for saying why a version failed. */
  lastExit?: { code: number | null; signal: string | null };
  constructor(private readonly options: SupervisorOptions) {}

  get address() {
    return `http://127.0.0.1:${this.options.port}`;
  }
  get runningRelease() {
    return this.release;
  }

  /** Starts the server from a release and waits up to `timeoutMs` for it to answer. */
  async start(release: Release, timeoutMs = 30_000): Promise<boolean> {
    this.release = release;
    this.wanted = true;
    this.lastExit = undefined;
    this.spawn();
    const ok = await this.healthy(timeoutMs);
    if (ok) this.options.onReady();
    return ok;
  }

  /** Stops the server: asks it to shut down, and ends its process tree if it has not after `graceMs`. */
  async stop(graceMs = 10_000): Promise<void> {
    this.wanted = false;
    clearTimeout(this.restartTimer);
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      this.setState("stopped");
      return;
    }
    this.setState("stopping");
    const exited = new Promise<void>((done) => child.once("exit", () => done()));
    try {
      if (child.connected) child.send({ type: "shutdown" } satisfies LauncherMessage);
      else if (!windows) child.kill("SIGTERM");
    } catch {
      /* Already gone. */
    }
    const timer = new Promise<"late">((done) => setTimeout(() => done("late"), graceMs).unref());
    if ((await Promise.race([exited, timer])) === "late") {
      killTree(child.pid);
      await exited;
    }
    this.setState("stopped");
  }

  send(message: LauncherMessage) {
    try {
      if (this.child?.connected) this.child.send(message);
    } catch {
      /* The server is restarting; it gets the state again when it is ready. */
    }
  }

  /** Whether the server answers `/api/health` within `timeoutMs` (false at once if it exits). */
  async healthy(timeoutMs: number): Promise<boolean> {
    const child = this.child;
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (!child || child.exitCode !== null || child.signalCode !== null) return false;
      try {
        const response = await fetch(`${this.address}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok && ((await response.json()) as { service?: string }).service === "pispark") {
          this.setState("running");
          return true;
        }
      } catch {
        /* Not listening yet. */
      }
      await new Promise((done) => setTimeout(done, 300));
    }
    return false;
  }

  private spawn() {
    const release = this.release!;
    this.setState("starting");
    const log = openLog(this.options.logFile);
    const child = spawn(release.node, [release.server], {
      cwd: dirname(release.server),
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(this.options.port),
        PISPARK_LAUNCHER: "1",
        ...(this.options.home ? { PISPARK_HOME: this.options.home } : {}),
      },
      stdio: ["ignore", log, log, "ipc"],
      windowsHide: true,
      // Its own process group on Linux, so a forced stop ends what it started too.
      detached: !windows,
    });
    closeSync(log);
    this.child = child;
    child.on("message", (message) => this.options.onMessage(message as ServerMessage));
    child.on("error", () => {
      /* Reported through exit. */
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      if (!this.wanted) return;
      this.lastExit = { code, signal };
      // Not asked to stop: a crash.
      const now = Date.now();
      this.crashes = [...this.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
      if (this.crashes.length >= QUICK_CRASHES) {
        this.wanted = false;
        this.setState("crashed");
        return;
      }
      this.setState("starting");
      const delay = Math.min(1000 * 2 ** (this.crashes.length - 1), 15_000);
      this.restartTimer = setTimeout(() => {
        this.spawn();
        void this.healthy(30_000).then((ok) => ok && this.options.onReady());
      }, delay);
    });
  }

  /** After giving up: try again (Restart in the tray, `pispark restart`). */
  async restart(): Promise<boolean> {
    await this.stop();
    this.crashes = [];
    return this.release ? this.start(this.release) : false;
  }

  private setState(state: ServerState) {
    if (this.state === state) return;
    this.state = state;
    this.options.onState(state);
  }
}

/** Ends a process and everything it started. */
export function killTree(pid: number | undefined) {
  if (!pid) return;
  if (windows) {
    spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* Gone. */
    }
  }
}

/** Opens a log for appending, moving it aside first when it has grown past 5 MB. */
export function openLog(file: string): number {
  mkdirSync(dirname(file), { recursive: true });
  try {
    if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) renameSync(file, `${file}.1`);
  } catch {
    /* Keep appending. */
  }
  return openSync(file, "a");
}
