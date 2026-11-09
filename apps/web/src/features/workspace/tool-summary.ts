import type { Json } from "../../../../server/src/stream-ops";

/** What a tool call is doing, in words: "Editing demo.ts", then "Edited demo.ts". */
export interface CallWords {
  /** While it runs. */
  doing: string;
  /** Once it finished. */
  done: string;
  /** What it works on, when its arguments say. */
  object?: string;
  /** How a group of such calls is counted: "Read 3 files". */
  group: "read" | "write" | "edit" | "run" | "search" | "other";
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const field = (args: Json, name: string): string | undefined =>
  args && typeof args === "object" && !Array.isArray(args) ? text(args[name]) : undefined;
const name = (path: string) => path.split(/[\\/]+/).filter(Boolean).at(-1) ?? path;
const short = (value: string, limit = 60) => {
  const line = value.split("\n")[0]!;
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
};

/** Pi's own tools are known by name; any other tool is described by its name alone. */
export function describeCall(toolName: string, args: Json): CallWords {
  const path = field(args, "path");
  switch (toolName) {
    case "read":
      return { doing: "Reading", done: "Read", object: path && name(path), group: "read" };
    case "write":
      return { doing: "Writing", done: "Wrote", object: path && name(path), group: "write" };
    case "edit":
      return { doing: "Editing", done: "Edited", object: path && name(path), group: "edit" };
    case "bash": {
      const command = field(args, "command");
      return { doing: "Running", done: "Ran", object: command && short(command), group: "run" };
    }
    case "grep": {
      const pattern = field(args, "pattern");
      return { doing: "Searching for", done: "Searched for", object: pattern && short(pattern), group: "search" };
    }
    case "find": {
      const pattern = field(args, "pattern") ?? field(args, "name");
      return { doing: "Finding", done: "Found", object: pattern && short(pattern), group: "search" };
    }
    case "ls":
      return { doing: "Listing", done: "Listed", object: path ? name(path) : undefined, group: "search" };
    default:
      return { doing: `Using ${toolName}`, done: `Used ${toolName}`, group: "other" };
  }
}

/** One line for a run of calls, in the order things first happened: "Wrote a.txt, ran 2 commands, read 3 files". */
export function summarizeCalls(calls: { name: string; args: Json }[]): string {
  const words = calls.map((call) => ({ ...describeCall(call.name, call.args), tool: call.name }));
  const noun = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const order = [...new Set(words.map((word) => (word.group === "other" ? `other:${word.tool}` : word.group)))];
  const parts = order.map((key, index) => {
    const same = words.filter((word) => (word.group === "other" ? `other:${word.tool}` : word.group) === key);
    const objects = new Set(same.map((word) => word.object ?? "")).size;
    const named = same.length === 1 && same[0]!.object ? same[0]!.object : undefined;
    const group = same[0]!.group;
    const lead = (verb: string) => (index === 0 ? verb[0]!.toUpperCase() + verb.slice(1) : verb);
    switch (group) {
      case "read":
        return `${lead("read")} ${noun(objects, "file")}`;
      case "edit":
        return `${lead("edited")} ${named ?? noun(objects, "file")}`;
      case "write":
        return `${lead("wrote")} ${named ?? noun(objects, "file")}`;
      case "run":
        return `${lead("ran")} ${noun(same.length, "command")}`;
      case "search":
        return `${lead("searched")} ${noun(same.length, "time")}`;
      default:
        return `${lead("used")} ${same[0]!.tool}`;
    }
  });
  return parts.join(", ");
}
