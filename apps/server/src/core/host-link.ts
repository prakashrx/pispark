import type { HostAction, LauncherMessage, LauncherStatus, RunningWork, ServerMessage } from "../contract/host-protocol.js";

/**
 * The server's side of the launcher's channel (Node's parent–child IPC). Present only when the
 * launcher started this server; otherwise nothing here does anything. Keeps the launcher's last
 * state, passes requests to it, answers what is running, and shuts down when asked.
 */
export class HostLink {
  private status?: LauncherStatus;
  readonly managed: boolean;
  constructor(
    private readonly running: () => RunningWork,
    private readonly shutdown: () => void,
  ) {
    this.managed = typeof process.send === "function" && process.env.PISPARK_LAUNCHER === "1";
    if (this.managed) process.on("message", (message) => this.receive(message as LauncherMessage));
  }
  launcher(): LauncherStatus | undefined {
    return this.status;
  }
  act(action: HostAction) {
    this.send({ type: "action", action });
  }
  /** Lets the process exit: an open IPC channel would keep it alive. */
  close() {
    if (this.managed && process.connected) process.disconnect();
  }
  private receive(message: LauncherMessage) {
    switch (message?.type) {
      case "status":
        this.status = message.status;
        break;
      case "shutdown":
        this.shutdown();
        break;
      case "running?":
        this.send({ type: "running", id: message.id, running: this.running() });
        break;
    }
  }
  private send(message: ServerMessage) {
    try {
      if (this.managed && process.connected) process.send!(message);
    } catch {
      /* The launcher is gone; the server keeps serving. */
    }
  }
}
