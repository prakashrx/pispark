import type { HostAction, HostStatus, UpdateState } from "../../../../server/src/contract/host-protocol";
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
  private watch?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly transport: Transport,
    private readonly back: () => void,
  ) {}

  get update(): UpdateState | undefined {
    return this.status?.launcher?.update;
  }
  /** A version is ready to install (or waiting for the right moment). */
  get ready(): string | undefined {
    const u = this.update;
    return u?.phase === "ready" || u?.phase === "waiting" ? u.version : undefined;
  }

  async refresh(): Promise<void> {
    try {
      const status = await this.transport.json<HostStatus>("/api/host");
      this.status = status;
      const u = status.launcher?.update;
      if (u?.phase === "restarting") this.away(u.version);
      else if (this.restarting) this.returned();
    } catch (error) {
      // Gone while it was restarting: expected. Watch for its return.
      if (this.restarting) this.watchReturn();
      else throw error;
    }
  }

  async act(action: HostAction): Promise<void> {
    try {
      await this.transport.json("/api/host", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
    } catch (error) {
      throw new CommandFailed((error as Error).message);
    }
    // Follow closely for a few seconds: a check or an update moves fast.
    for (let i = 0; i < 10 && !this.restarting; i++) {
      await new Promise((done) => setTimeout(done, 500));
      await this.refresh().catch(() => {});
    }
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
        this.status = status;
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

export function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(0)} MB` : `${Math.round(bytes / 1024)} KB`;
}
