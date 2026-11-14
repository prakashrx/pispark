import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { Release } from "./install.ts";

export type TrayChoice = "open" | "update" | "restart" | "logs" | "quit";

/** The Windows tray: a hidden PowerShell NotifyIcon (no extra binaries), talking over its stdio. */
export class Tray {
  private child?: ChildProcess;
  constructor(
    private readonly release: Release,
    private readonly onChoice: (choice: TrayChoice) => void,
  ) {}
  start() {
    const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", this.release.tray, "-Icon", this.release.icon], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.child = child;
    let buffer = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const word = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (["open", "update", "restart", "logs", "quit"].includes(word)) this.onChoice(word as TrayChoice);
      }
    });
    child.on("error", () => {});
    child.stdin!.on("error", () => {});
  }
  /** `line`: the state shown at the top of the menu; `update`: the update item's label, if any. */
  show(line: string, update?: string) {
    if (this.child?.stdin?.writable) this.child.stdin.write(`state ${JSON.stringify({ line, update: update ?? "" })}\n`);
  }
  stop() {
    this.child?.stdin?.end();
    this.child = undefined;
  }
}
