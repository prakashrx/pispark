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

/** What the output view shows: the newest text (at most `keep` characters), where the next read starts, and whether older output is missing. */
export interface ShownOutput {
  text: string;
  next: number;
  cut?: boolean;
}
/** One read brings at most this much (the server's limit). */
export const OUTPUT_READ = 64 * 1024;
/**
 * Where the output view reads next. A process that prints faster than one read a second would never be
 * caught up with, so when the view is more than two reads behind it starts again from near the end.
 */
export function nextRead(written: number, shown: ShownOutput | undefined): { since: number; fresh: boolean } {
  const at = shown?.next ?? 0;
  return written - at > 2 * OUTPUT_READ ? { since: written - OUTPUT_READ, fresh: true } : { since: at, fresh: false };
}
/** The view after a read: appended, or (`fresh`) started again; never more than `keep` characters. */
export function shownAfter(shown: ShownOutput | undefined, read: ShownOutput, fresh: boolean, keep = 200_000): ShownOutput {
  const text = (fresh ? "" : (shown?.text ?? "")) + read.text;
  return {
    text: text.length > keep ? text.slice(-keep) : text,
    next: read.next,
    cut: fresh || read.cut || text.length > keep || shown?.cut,
  };
}
