import type { ProcessInfo } from "../../../../server/src/contract/process-protocol";

/** A process's state in words that do not depend on color. */
export function processState(process: ProcessInfo, now = Date.now()): string {
  if (process.state === "running") {
    const minutes = Math.floor((now - new Date(process.startedAt).getTime()) / 60_000);
    return minutes < 1 ? "Running" : minutes < 60 ? `Running · ${minutes} min` : `Running · ${Math.floor(minutes / 60)} h`;
  }
  if (process.ended === "pispark-stopped") return "Ended when PiSpark stopped";
  if (process.ended === "timeout") return "Stopped at its time limit";
  if (process.ended === "stopped") return "Stopped";
  if (process.exitCode === undefined) return "Could not start";
  return `Exited ${process.exitCode}`;
}
/** What a process is called: its title, or its command. */
export const processName = (process: Pick<ProcessInfo, "title" | "command">) => process.title ?? process.command;
