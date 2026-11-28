import type { HostAction, HostStatus, ReleaseNotes, UpdateState } from "../../../../server/src/contract/host-protocol";
import { CommandFailed, type Transport } from "../workspace/transport";

/**
 * This PiSpark's version, where it runs and its updates (`/api/host`), read with the session list.
 * While an update restarts the server it knows the server is away on purpose, says so instead of
 * "Connection lost", and reconnects the window by itself once the server is back.
 */
export class HostClient {
  status = $state<HostStatus>();
  /** The version an update is restarting into, while the server is away. */
  restarting = $state<string>();
  /** The server now runs a newer version than the one this page was loaded from. */
  updated = $state<string>();
  /** What is new in the version that runs, once read; undefined when it has no notes. */
  notes = $state<ReleaseNotes>();
  /** The version this page was loaded from. */
  private loaded?: string;
  private watch?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly transport: Transport,
    private readonly back: () => void,
  ) {}

  get update(): UpdateState | undefined {
    return this.status?.launcher?.update;
  }
  /** A newer version is available (or waiting for the right moment to install). */
  get available(): string | undefined {
    const u = this.update;
    return u?.phase === "available" || u?.phase === "waiting" ? u.version : undefined;
  }

  async refresh(): Promise<void> {
    try {
      const status = await this.transport.json<HostStatus>("/api/host");
      this.seen(status);
      const u = status.launcher?.update;
      if (u?.phase === "restarting") this.away(u.version);
      else if (this.restarting) this.returned();
    } catch (error) {
      // Gone while it was restarting: expected. Watch for its return.
      if (this.restarting) this.watchReturn();
      else throw error;
    }
  }

  /** Reads what is new in the version that runs. A version without notes has none to show. */
  async readNotes(): Promise<void> {
    this.notes = await this.transport.json<ReleaseNotes>("/api/host/notes").catch(() => undefined);
  }

  async act(action: HostAction): Promise<void> {
    try {
      await this.transport.json("/api/host", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
    } catch (error) {
      throw new CommandFailed((error as Error).message);
    }
    // Follow closely for a few seconds: a check or an update moves fast.
    for (let i = 0; i < 10 && !this.restarting; i++) {
      await new Promise((done) => setTimeout(done, 500));
      await this.refresh().catch(() => {});
    }
  }

  private seen(status: HostStatus) {
    this.status = status;
    this.loaded ??= status.version;
    if (status.version !== this.loaded) this.updated = status.version;
  }
  private away(version: string) {
    this.restarting = version;
    this.watchReturn();
  }
  private returned() {
    this.restarting = undefined;
    clearTimeout(this.watch);
    this.back();
  }
  /** Asks once a second whether the server is back, and not still restarting. */
  private watchReturn() {
    clearTimeout(this.watch);
    this.watch = setTimeout(async () => {
      try {
        const status = await this.transport.json<HostStatus>("/api/host");
        this.seen(status);
        if (status.launcher?.update.phase !== "restarting") return this.returned();
      } catch {
        /* Not back yet. */
      }
      if (this.restarting) this.watchReturn();
    }, 1000);
  }
  dispose() {
    clearTimeout(this.watch);
  }
}
