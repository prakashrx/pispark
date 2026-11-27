import type { Json } from "../../../../server/src/contract/stream-ops";
import type { Schedule } from "../../../../server/src/contract/schedule-protocol";
import { describeSchedule } from "../../../../server/src/contract/cron";
import type { Segment, ToolCall } from "./session-turns";
import { registerGenericToolView, registerToolView, resolveToolView, type CallWords, type ToolView } from "./views.svelte";

/**
 * PiSpark's own views of tools: Pi's built-in ones by name, and a generic one for the rest, so none
 * of the conversation's code needs to know a tool by name. Extensions draw their tools with a
 * component at `item.tool:<name>` instead (see extension-views.ts).
 */

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const field = (value: Json | undefined, name: string): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value[name] : undefined;
const arg = (call: ToolCall, name: string) => text(field(call.args, name));
const base = (path: string) => path.split(/[\\/]+/).filter(Boolean).at(-1) ?? path;
const short = (value: string, limit = 60) => {
  const line = value.split("\n")[0]!;
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
};
const noun = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const files = (calls: ToolCall[]) => new Set(calls.map((call) => arg(call, "path") ?? "")).size;
const named = (calls: ToolCall[]) => {
  const path = calls.length === 1 ? arg(calls[0]!, "path") : undefined;
  return path ? base(path) : noun(files(calls), "file");
};

/** What any tool's finished call can put in the message: the changes it made, the pictures it returned. */
export function genericArtifacts(call: ToolCall): Segment[] {
  const result = call.result;
  if (!result) return [];
  const out: Segment[] = [];
  const path = arg(call, "path");
  const patch = field(result.details, "patch");
  if (typeof patch === "string" && patch.trim())
    out.push({ kind: "diff", key: `diff.${call.id}`, patch, path, clipped: result.clipped === true });
  result.parts.forEach((part, index) => {
    if (part.type === "image")
      out.push({ kind: "image", key: `image.${call.id}.${index}`, itemId: result.id, part: index, mimeType: part.mimeType, bytes: part.bytes, alt: `Image from ${call.name}` });
  });
  return out;
}

const generic: ToolView = {
  describe: (call) => ({ doing: `Using ${call.name}`, done: `Used ${call.name}` }),
  summarize: (calls) => `used ${calls[0]!.name}`,
  artifacts: genericArtifacts,
};
registerGenericToolView(generic);

const on = (call: ToolCall) => {
  const path = arg(call, "path");
  return path ? base(path) : undefined;
};
const words = (doing: string, done: string, object: (call: ToolCall) => string | undefined): ToolView["describe"] => (call) => ({ doing, done, object: object(call) });

registerToolView("read", { describe: words("Reading", "Read", on), group: "read", summarize: (calls) => `read ${noun(files(calls), "file")}`, artifacts: genericArtifacts });
registerToolView("edit", { describe: words("Editing", "Edited", on), group: "edit", summarize: (calls) => `edited ${named(calls)}`, artifacts: genericArtifacts });
registerToolView("write", {
  describe: words("Writing", "Wrote", on),
  group: "write",
  summarize: (calls) => `wrote ${named(calls)}`,
  artifacts(call) {
    const out = genericArtifacts(call);
    const path = arg(call, "path");
    const markup = field(call.args, "content");
    // An SVG a tool wrote is drawn from what it wrote, once the write is done.
    if (call.status === "done" && path && /\.svg$/i.test(path) && typeof markup === "string" && markup.includes("<svg"))
      out.push({ kind: "svg", key: `svg.${call.id}`, markup, alt: path, clipped: call.clipped === true });
    return out;
  },
});
registerToolView("bash", {
  describe: words("Running", "Ran", (call) => {
    const command = arg(call, "command");
    return command && short(command);
  }),
  group: "run",
  summarize: (calls) => `ran ${noun(calls.length, "command")}`,
  artifacts: genericArtifacts,
});
const search = (doing: string, done: string, key: string): ToolView => ({
  describe: words(doing, done, (call) => {
    const value = arg(call, key) ?? arg(call, "name");
    return value && short(value);
  }),
  group: "search",
  summarize: (calls) => `searched ${noun(calls.length, "time")}`,
  artifacts: genericArtifacts,
});
registerToolView("grep", search("Searching for", "Searched for", "pattern"));
registerToolView("find", search("Finding", "Found", "pattern"));
registerToolView("ls", { describe: words("Listing", "Listed", on), group: "search", summarize: (calls) => `searched ${noun(calls.length, "time")}`, artifacts: genericArtifacts });

// PiSpark's own tools, the ten verbs a session says about what it started: words for each, and what
// a start made, as a row. A start names what it made in the call's details.
const made = (call: ToolCall) => (call.status === "done" ? text(field(call.result?.details, "id")) : undefined);
const sessionRow = (call: ToolCall): Segment[] => {
  const id = made(call);
  return id ? [{ kind: "session", key: `session.${call.id}`, sessionId: id, title: arg(call, "title") ?? "A session" }] : [];
};
const processRow = (call: ToolCall): Segment[] => {
  const id = made(call);
  return id ? [{ kind: "process", key: `process.${call.id}`, processId: id, title: arg(call, "title") ?? arg(call, "command") ?? "A process" }] : [];
};
const savedSchedule = (call: ToolCall) => {
  const schedule = field(call.result?.details, "schedule");
  return schedule && typeof schedule === "object" && !Array.isArray(schedule) && typeof schedule.id === "string" ? (schedule as unknown as Schedule) : undefined;
};
/** One verb's view: its words, one line for several calls, and what it puts in the message. */
const verb = (name: string, describe: ToolView["describe"], summarize: (calls: ToolCall[]) => string, artifacts: ToolView["artifacts"] = () => []) =>
  registerToolView(`pispark_${name}`, { describe, group: name, summarize, artifacts });
const said = (call: ToolCall) => {
  const value = arg(call, "text");
  return value && short(value);
};
const argOf = (key: string) => (call: ToolCall) => arg(call, key);

verb(
  "start_session",
  (call) => ({ doing: "Starting a session", done: arg(call, "title") ? `Started ${short(arg(call, "title")!)}` : "Started a session" }),
  (calls) => `started ${noun(calls.length, "session")}`,
  sessionRow,
);
verb(
  "start_process",
  words("Starting", "Started", (call) => {
    const name = arg(call, "title") ?? arg(call, "command");
    return name && short(name);
  }),
  (calls) => `started ${noun(calls.length, "process", "processes")}`,
  processRow,
);
verb(
  "schedule",
  (call) => {
    const saved = savedSchedule(call);
    return { doing: "Adding a schedule", done: saved ? `Scheduled ${describeSchedule(saved).replace(/^./, (c) => c.toLowerCase())}` : "Added no schedule" };
  },
  (calls) => {
    const added = calls.filter((call) => savedSchedule(call)).length;
    return added ? `added ${noun(added, "schedule")}` : "added no schedule";
  },
  (call) => {
    const schedule = call.status === "done" ? savedSchedule(call) : undefined;
    return schedule ? [{ kind: "schedule", key: `schedule.${call.id}`, schedule }] : [];
  },
);
verb("send", words("Sending to", "Sent to", argOf("id")), (calls) => `sent ${noun(calls.length, "message")}`);
verb(
  "wait",
  (call) => {
    const ids = field(call.args, "ids");
    return { doing: "Waiting for", done: "Waited for", object: Array.isArray(ids) && ids.length ? ids.join(", ") : "what it started" };
  },
  (calls) => `waited ${noun(calls.length, "time")}`,
);
verb("look", words("Looking at", "Looked at", (call) => arg(call, "id") ?? "what it started"), (calls) => `looked ${noun(calls.length, "time")}`);
verb("stop", words("Stopping", "Stopped", argOf("id")), (calls) => `stopped ${noun(calls.length, "thing")}`);
verb("raise", words("Raising", "Raised", said), () => "raised a question");
verb("note", words("Noting", "Noted", said), (calls) => `left ${noun(calls.length, "note")}`);
verb(
  "self",
  (call) => (arg(call, "action") === "reload" ? { doing: "Asking to reload", done: "Asked to reload" } : { doing: "Inspecting this session", done: "Inspected this session" }),
  () => "looked at itself",
);

// Calls from before the ten verbs, in older conversations: what a start made still shows as a row.
const older = (row: (call: ToolCall) => Segment[]): ToolView => ({ ...generic, artifacts: (call) => (arg(call, "action") === "start" ? row(call) : []) });
registerToolView("pispark_session", older(sessionRow));
registerToolView("pispark_process", older(processRow));

/** What a call is doing, in words. */
export const describeCall = (call: ToolCall): CallWords => resolveToolView(call.name).describe(call);

/** What a call puts in the message itself. A view that does not say gets the generic artifacts. */
export function artifactsOf(call: ToolCall): Segment[] {
  const view = resolveToolView(call.name);
  return view.artifacts ? view.artifacts(call) : genericArtifacts(call);
}

/** One line for a run of calls, in the order things first happened: "Wrote a.txt, ran 2 commands, read 3 files". */
export function summarizeCalls(calls: ToolCall[]): string {
  const groups = new Map<string, ToolCall[]>();
  for (const call of calls) {
    const key = resolveToolView(call.name).group ?? `tool:${call.name}`;
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  return [...groups.values()]
    .map((members) => {
      const view = resolveToolView(members[0]!.name);
      return view.summarize?.(members) ?? `used ${members[0]!.name}`;
    })
    .map((phrase, index) => (index === 0 ? phrase[0]!.toUpperCase() + phrase.slice(1) : phrase))
    .join(", ");
}
