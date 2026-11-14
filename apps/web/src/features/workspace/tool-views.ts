import type { Json } from "../../../../server/src/contract/stream-ops";
import type { Segment, ToolCall } from "./chat-turns";
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

// PiSpark's own session tool: words for each action, and the session a start made, as a row.
const startedId = (call: ToolCall) => /\(id ([0-9a-f-]{36})\)/.exec((call.result?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join(""))?.[1];
registerToolView("pispark_session", {
  describe(call) {
    const action = arg(call, "action");
    const title = arg(call, "title");
    if (action === "start") return { doing: "Starting a session", done: title ? `Started ${short(title)}` : "Started a session" };
    if (action === "list") return { doing: "Listing its sessions", done: "Listed its sessions" };
    if (action === "send") return { doing: "Sending to a session", done: "Sent to a session" };
    if (action === "stop") return { doing: "Stopping a session", done: "Stopped a session" };
    return { doing: "Reading a session's answer", done: "Read a session's answer" };
  },
  group: "sessions",
  summarize: (calls) => {
    const started = calls.filter((call) => arg(call, "action") === "start").length;
    return started ? `started ${noun(started, "session")}` : `used ${noun(calls.length, "session action")}`;
  },
  artifacts(call) {
    const id = call.status === "done" && arg(call, "action") === "start" ? startedId(call) : undefined;
    return id ? [{ kind: "session", key: `session.${call.id}`, sessionId: id, title: arg(call, "title") ?? "A session" }] : [];
  },
});

// PiSpark's own process tool: words for each action, and the process a start made, as a row.
const processId = (call: ToolCall) => /^Started ([0-9a-f-]{36}):/.exec((call.result?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join(""))?.[1];
registerToolView("pispark_process", {
  describe(call) {
    const action = arg(call, "action");
    const name = arg(call, "title") ?? arg(call, "command");
    if (action === "start") return { doing: "Starting", done: "Started", object: name && short(name) };
    if (action === "list") return { doing: "Listing its processes", done: "Listed its processes" };
    if (action === "output") return { doing: "Reading output", done: "Read output" };
    if (action === "watch") return { doing: "Watching output", done: "Watching output" };
    if (action === "unwatch") return { doing: "Stopping a watch", done: "Stopped a watch" };
    return { doing: "Stopping a process", done: "Stopped a process" };
  },
  group: "processes",
  summarize: (calls) => {
    const started = calls.filter((call) => arg(call, "action") === "start").length;
    return started ? `started ${noun(started, "process", "processes")}` : `used ${noun(calls.length, "process action")}`;
  },
  artifacts(call) {
    const id = call.status === "done" && arg(call, "action") === "start" ? processId(call) : undefined;
    return id ? [{ kind: "process", key: `process.${call.id}`, processId: id, title: arg(call, "title") ?? arg(call, "command") ?? "A process" }] : [];
  },
});
registerToolView("pispark_report", {
  describe: () => ({ doing: "Raising it with the session that started this one", done: "Raised it with the session that started this one" }),
  summarize: () => "raised it with the starting session",
});

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
