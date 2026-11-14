import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:net";
import { join } from "node:path";
import type { HostAction, LauncherStatus, RunningWork, ServerMessage, UpdateState } from "../../server/src/contract/host-protocol.ts";
import { callControl, serveControl, type ControlRequest, type ControlStatus } from "./control.ts";
import { autostartEnabled, openFolder, openWindow, underSystemd } from "./desktop.ts";
import { Install, LAUNCHER_VERSION, Release, VERSION, windows } from "./install.ts";
import { Supervisor, killTree } from "./supervisor.ts";
import { Tray, type TrayChoice } from "./tray.ts";
import { RELEASES_URL, check, fetchRelease, find, listReleases, type Available } from "./updates.ts";

const DAY_MS = 24 * 60 * 60_000;
const IDLE_POLL_MS = 30_000;
const HEALTH_MS = 30_000;

/** Exit code that asks systemd to start PiSpark again (`Restart=on-failure`). */
export const RESTART_EXIT = 75;

/**
 * The running launcher (`pispark run`): runs the server from the current version, keeps it running,
 * checks for updates and switches versions, rolling back a version that does not start. The tray
 * and the command line talk to it; the server relays the browser's requests.
 */
export class Daemon {
  private readonly supervisor: Supervisor;
  private control?: Server;
  private tray?: Tray;
  private update: UpdateState = { phase: "idle" };
  private available?: Available;
  private checkTimer?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private queries = new Map<number, (running: RunningWork) => void>();
  private nextQuery = 1;
  private busy = false;
  private readonly log: string;
  /** Read once: whether PiSpark starts at login (asking the system on every state change is wasteful). */
  private readonly startsAtLogin = autostartEnabled();

  constructor(
    private readonly install: Install,
    /** The release this launcher runs from. */
    private readonly own: Release,
  ) {
    this.log = join(install.logs, "launcher.log");
    const choices = install.choices();
    this.supervisor = new Supervisor({
      port: choices.port,
      ...(choices.home ? { home: choices.home } : {}),
      logFile: join(install.logs, "server.log"),
      onMessage: (message) => this.fromServer(message),
      onState: (state) => {
        this.note(`server ${state}`);
        this.showTray();
      },
      onReady: () => this.push(),
    });
  }

  async run(): Promise<void> {
    mkdirSync(this.install.logs, { recursive: true });
    try {
      this.control = await serveControl(this.install.root, (request) => this.handle(request));
    } catch {
      console.error("PiSpark is already running for this install.");
      process.exit(0);
    }
    this.note(`launcher ${this.own.info.version} (launcher ${LAUNCHER_VERSION}) starting`);
    this.readRollback();
    // Versions that failed here are never used again.
    for (const version of this.install.failed()) if (version !== this.own.info.version && this.install.installed().includes(version)) this.install.remove(version);
    // A version being tried (Linux handover): it has this long to come up, or systemd starts the previous one.
    const trying = this.install.trying()?.version === this.own.info.version;
    if (trying) setTimeout(() => this.supervisor.state !== "running" && process.exit(1), HEALTH_MS + 15_000).unref();
    if (windows && !process.env.PISPARK_NO_TRAY) {
      this.tray = new Tray(this.own, (choice) => void this.fromTray(choice));
      this.tray.start();
    }
    const ok = await this.supervisor.start(this.own, HEALTH_MS);
    if (ok && trying) {
      this.install.confirm();
      this.install.prune([this.own.info.version]);
    }
    if (!ok) this.note("server did not answer at start");
    process.on("SIGTERM", () => void this.quit());
    process.on("SIGINT", () => void this.quit());
    this.schedule(60_000);
  }

  // ---- State shown to the server, the browser and the tray ----

  private status(): LauncherStatus {
    const choices = this.install.choices();
    return {
      version: this.supervisor.runningRelease?.info.version ?? this.own.info.version,
      channel: choices.channel,
      autoUpdate: choices.autoUpdate,
      update: this.update,
      program: this.install.root,
      logs: this.install.logs,
      startsAtLogin: this.startsAtLogin,
      ...(choices.kept ? { kept: choices.kept } : {}),
    };
  }
  private setUpdate(update: UpdateState) {
    this.update = update;
    this.push();
  }
  private push() {
    this.supervisor.send({ type: "status", status: this.status() });
    this.showTray();
  }
  private showTray() {
    if (!this.tray) return;
    const version = this.supervisor.runningRelease?.info.version ?? this.own.info.version;
    const state =
      { starting: "starting", running: "running", stopping: "stopping", stopped: "stopped", crashed: "stopped after repeated crashes" }[this.supervisor.state] ?? this.supervisor.state;
    const u = this.update;
    const label = u.phase === "ready" ? `Update to v${u.version} and restart` : u.phase === "waiting" ? `Update to v${u.version} now` : undefined;
    this.tray.show(`PiSpark · ${state} · v${version}`, label);
  }

  // ---- Requests ----

  private async handle(request: ControlRequest): Promise<unknown> {
    switch (request.cmd) {
      case "status":
        return {
          pid: process.pid,
          version: this.supervisor.runningRelease?.info.version ?? this.own.info.version,
          launcher: LAUNCHER_VERSION,
          server: this.supervisor.state,
          address: this.supervisor.address,
        } satisfies ControlStatus;
      case "open":
        openWindow(this.supervisor.address);
        return {};
      case "stop":
        setTimeout(() => void this.quit(), 50);
        return {};
      case "restart":
        void this.supervisor.restart();
        return {};
      case "check":
        await this.act({ action: "check" });
        return this.update;
      case "install":
        return this.installVersion(request.version);
      case "update":
        if (this.install.choices().kept) throw new Error(`PiSpark is kept at ${this.install.choices().kept}. Resume updates in Settings → About, or install another version with: pispark install <version>`);
        if (this.update.phase === "idle" || this.update.phase === "current" || this.update.phase === "error") await this.act({ action: "check" });
        if (this.update.phase === "ready") await this.act({ action: "apply", when: "now" });
        return this.update;
    }
  }

  private fromServer(message: ServerMessage) {
    if (message.type === "action") void this.act(message.action);
    else if (message.type === "running") {
      this.queries.get(message.id)?.(message.running);
      this.queries.delete(message.id);
    }
  }

  private async fromTray(choice: TrayChoice) {
    switch (choice) {
      case "open":
        openWindow(this.supervisor.address);
        break;
      case "logs":
        openFolder(this.install.logs);
        break;
      case "restart":
        await this.supervisor.restart();
        break;
      case "quit":
        await this.quit();
        break;
      case "update": {
        // Something running: the window's About page says what, and offers to wait.
        const running = await this.running();
        if (running.replies.length || running.processes.length) openWindow(`${this.supervisor.address}/#/about`);
        else await this.act({ action: "apply", when: "now" });
        break;
      }
    }
  }

  async act(action: HostAction): Promise<void> {
    switch (action.action) {
      case "check":
        return this.check();
      case "configure": {
        const before = this.install.choices();
        this.install.choose({ ...(action.channel ? { channel: action.channel } : {}), ...(action.autoUpdate !== undefined ? { autoUpdate: action.autoUpdate } : {}) });
        if (action.channel && action.channel !== before.channel && !this.busyPhase()) {
          this.available = undefined;
          this.update = { phase: "idle" };
          void this.check();
        }
        this.push();
        // Switched on with an update already downloaded: install it when idle.
        if (action.autoUpdate && !before.autoUpdate && this.update.phase === "ready") await this.act({ action: "apply", when: "idle" });
        return;
      }
      case "resume":
        if (!this.install.choices().kept) return;
        this.install.choose({ kept: undefined });
        this.note("updates resumed");
        this.update = { phase: "idle" };
        this.push();
        return this.check();
      case "cancel":
        if (this.update.phase === "waiting") {
          clearTimeout(this.idleTimer);
          this.setUpdate({ phase: "ready", version: this.update.version, ...(this.available?.notes ? { notes: this.available.notes } : {}) });
        }
        return;
      case "apply":
        if (this.update.phase !== "ready" && this.update.phase !== "waiting") return;
        if (action.when === "now") return this.switchTo(this.update.version);
        clearTimeout(this.idleTimer);
        this.setUpdate({ phase: "waiting", version: this.update.version });
        return this.whenIdle();
    }
  }

  private busyPhase() {
    return ["checking", "downloading", "waiting", "restarting"].includes(this.update.phase);
  }

  // ---- Checking and downloading ----

  private schedule(delay: number) {
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      void this.check().finally(() => this.schedule(DAY_MS));
    }, delay);
    this.checkTimer.unref();
  }

  private async check() {
    if (this.busyPhase() || this.update.phase === "ready" || this.install.choices().kept) return;
    this.setUpdate({ phase: "checking" });
    const choices = this.install.choices();
    try {
      const current = this.supervisor.runningRelease?.info.version ?? this.own.info.version;
      const found = await check(choices.releases ?? RELEASES_URL, { channel: choices.channel, os: this.own.info.os, arch: this.own.info.arch, current, failed: this.install.failed() });
      if (!found) return this.setUpdate({ phase: "current", checkedAt: new Date().toISOString() });
      this.available = found;
      this.note(`downloading ${found.version}`);
      this.setUpdate({ phase: "downloading", version: found.version, received: 0 });
      await fetchRelease(this.install, found, (received, total) => {
        this.update = { phase: "downloading", version: found.version, received, ...(total ? { total } : {}) };
        this.push();
      });
      this.note(`${found.version} ready`);
      this.setUpdate({ phase: "ready", version: found.version, ...(found.notes ? { notes: found.notes } : {}) });
      if (choices.autoUpdate) await this.act({ action: "apply", when: "idle" });
    } catch (error) {
      this.note(`update check failed: ${(error as Error).message}`);
      this.setUpdate({ phase: "error", message: (error as Error).message, at: new Date().toISOString() });
    }
  }

  /**
   * `pispark install <version>`: that exact version, on any channel, older or newer, downloaded if
   * needed; then kept there (no update checks) until updates are resumed. A version that does not
   * start rolls back like any update, and is not kept.
   */
  private async installVersion(version: string): Promise<UpdateState & { kept?: string }> {
    if (!VERSION.test(version)) throw new Error(`Not a version: ${version}`);
    if (this.busy || ["downloading", "restarting"].includes(this.update.phase)) throw new Error("PiSpark is updating; try again when it is done.");
    const current = this.supervisor.runningRelease?.info.version ?? this.own.info.version;
    this.install.unmarkFailed(version);
    if (version !== current && !this.install.installed().includes(version)) {
      const choices = this.install.choices();
      const found = find(await listReleases(choices.releases ?? RELEASES_URL), version, this.own.info.os, this.own.info.arch);
      if (!found) throw new Error(`There is no release ${version} for ${this.own.info.os}-${this.own.info.arch}.`);
      this.note(`downloading ${version} (asked for)`);
      this.setUpdate({ phase: "downloading", version, received: 0 });
      try {
        await fetchRelease(this.install, found, (received, total) => {
          this.update = { phase: "downloading", version, received, ...(total ? { total } : {}) };
          this.push();
        });
      } catch (error) {
        this.setUpdate({ phase: "error", message: (error as Error).message, at: new Date().toISOString() });
        throw error;
      }
    }
    this.install.choose({ kept: version });
    if (version === current) {
      this.setUpdate({ phase: "current", checkedAt: new Date().toISOString() });
      return { ...this.update, kept: version };
    }
    await this.switchTo(version);
    if (this.update.phase === "failed") this.install.choose({ kept: undefined });
    this.push();
    return { ...this.update, ...(this.install.choices().kept ? { kept: version } : {}) };
  }

  // ---- Switching versions ----

  /** What a restart would interrupt, asked of the server (nothing if it does not answer). */
  private running(): Promise<RunningWork> {
    const none = { replies: [], processes: [] };
    if (this.supervisor.state !== "running") return Promise.resolve(none);
    const id = this.nextQuery++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.queries.delete(id);
        resolve(none);
      }, 5000);
      this.queries.set(id, (running) => {
        clearTimeout(timer);
        resolve(running);
      });
      this.supervisor.send({ type: "running?", id });
    });
  }

  private async whenIdle() {
    if (this.update.phase !== "waiting") return;
    const running = await this.running();
    if (this.update.phase !== "waiting") return;
    if (!running.replies.length && !running.processes.length) return this.switchTo(this.update.version);
    this.idleTimer = setTimeout(() => void this.whenIdle(), IDLE_POLL_MS);
  }

  private async switchTo(version: string) {
    if (this.busy) return;
    this.busy = true;
    clearTimeout(this.idleTimer);
    const old = this.supervisor.runningRelease ?? this.own;
    let next: Release;
    try {
      next = Release.at(this.install.release(version));
    } catch {
      this.busy = false;
      return this.setUpdate({ phase: "error", message: `${version} is not downloaded`, at: new Date().toISOString() });
    }
    this.note(`switching ${old.info.version} -> ${version}${next.info.launcher !== LAUNCHER_VERSION ? " (new launcher)" : ""}`);
    this.setUpdate({ phase: "restarting", version });
    // Give open windows a moment to see "restarting" before the server goes.
    await new Promise((done) => setTimeout(done, 1500));
    if (next.info.launcher !== LAUNCHER_VERSION) return this.handOver(old, next);

    await this.supervisor.stop();
    if (await this.supervisor.start(next, HEALTH_MS)) {
      this.install.point(version);
      this.install.prune([this.own.info.version, version]);
      this.note(`now on ${version}`);
      this.available = undefined;
      this.busy = false;
      return this.setUpdate({ phase: "current", checkedAt: new Date().toISOString() });
    }
    const exit = this.supervisor.lastExit;
    await this.rollBack(old, version, exit ? `It stopped while starting (exit code ${exit.code ?? exit.signal}). See the server log.` : "It did not answer within 30 seconds. See the server log.");
  }

  private async rollBack(old: Release, version: string, reason: string) {
    this.note(`${version} failed: ${reason}; back to ${old.info.version}`);
    await this.supervisor.stop();
    this.install.markFailed(version);
    this.install.point(old.info.version);
    await this.supervisor.start(old, HEALTH_MS);
    if (version !== this.own.info.version) this.install.remove(version);
    this.available = undefined;
    this.busy = false;
    this.setUpdate({ phase: "failed", version, reason, at: new Date().toISOString() });
  }

  /**
   * A release with a different launcher. Linux under systemd: record the try, point `current` at it
   * and exit; systemd runs pispark-start, which rolls back if the new launcher does not confirm
   * itself. Elsewhere: start the new launcher, wait for it to report a healthy server, then exit;
   * if it does not, end it and carry on here.
   */
  private async handOver(old: Release, next: Release) {
    const version = next.info.version;
    if (underSystemd()) {
      this.install.startTrying(version, old.info.version);
      this.install.point(version);
      await this.supervisor.stop();
      this.note(`handing over to ${version} through systemd`);
      process.exit(RESTART_EXIT);
    }
    await this.supervisor.stop();
    this.tray?.stop();
    await new Promise<void>((done) => (this.control ? this.control.close(() => done()) : done()));
    this.install.point(version);
    const child = spawn(next.windowless, [next.launcher, "run"], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    const until = Date.now() + HEALTH_MS + 15_000;
    while (Date.now() < until) {
      const status = await callControl<ControlStatus>(this.install.root, { cmd: "status" }, 2000);
      if (status?.version === version && status.server === "running") {
        this.note(`handed over to ${version}`);
        this.install.prune([old.info.version, version]);
        process.exit(0);
      }
      if (child.exitCode !== null) break;
      await new Promise((done) => setTimeout(done, 1000));
    }
    killTree(child.pid);
    this.control = await serveControl(this.install.root, (request) => this.handle(request));
    if (this.tray) {
      this.tray = new Tray(this.own, (choice) => void this.fromTray(choice));
      this.tray.start();
    }
    await this.rollBack(old, version, "Its launcher did not start PiSpark within 45 seconds. See the logs.");
  }

  /** pispark-start rolled back a launcher that failed (Linux): say so once. */
  private readRollback() {
    const file = join(this.install.update, "rolled-back");
    if (!existsSync(file)) return;
    const version = readFileSync(file, "utf8").trim();
    rmSync(file, { force: true });
    if (version) this.update = { phase: "failed", version, reason: "Its launcher did not start. PiSpark went back to this version.", at: new Date().toISOString() };
  }

  async quit() {
    this.note("quitting");
    clearTimeout(this.checkTimer);
    clearTimeout(this.idleTimer);
    await this.supervisor.stop();
    this.tray?.stop();
    this.control?.close();
    process.exit(0);
  }

  private note(text: string) {
    try {
      appendFileSync(this.log, `${new Date().toISOString()} ${text}\n`);
    } catch {
      /* Logging must not stop the launcher. */
    }
  }
}
