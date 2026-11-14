import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { chatTitle } from "../../contract/chat-title.js";
import { TITLE_TOOL } from "../runtime/chat-title.js";
import { SCHEDULE_CHANNEL, SCHEDULE_TOOL, type ScheduleMessage, type ScheduleRequest } from "../runtime/schedule-tool.js";
import { REPORT_TOOL, SESSION_CHANNEL, SESSION_TOOL, type SessionMessage, type SessionRequest } from "../runtime/session-tool.js";
import { PROCESS_CHANNEL, PROCESS_TOOL, type ProcessMessage, type ProcessRequest } from "../runtime/process-tool.js";

/** "2026-11-13 14:30 (UTC+01:00)": the server's local time, for the agent to schedule by. */
function localNow(now = new Date()): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const zone = `UTC${offset < 0 ? "-" : "+"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} (${zone})`;
}

/**
 * Ordinary native Pi extension, instantiated separately for every hosted session. Its title tool
 * names the session with Pi's own `setSessionName`; the session's name is the chat title. Its
 * schedule tool asks PiSpark (which asks the person first) to wake this session later. Its session
 * tool asks PiSpark to start and follow child sessions, whose answers come back as messages.
 */
export default function pispark(pi: ExtensionAPI): void {
  pi.registerTool({
    name: TITLE_TOOL,
    label: "Set chat title",
    description:
      "Give this chat a short, meaningful title when its purpose is clear. Update it only when the topic meaningfully changes.",
    parameters: Type.Object(
      { title: Type.String({ maxLength: 4096 }) },
      { additionalProperties: false },
    ),
    async execute(_id, parameters, signal) {
      if (signal?.aborted) throw new Error("Cancelled");
      const title = typeof parameters.title === "string" && parameters.title.length <= 4096 ? chatTitle(parameters.title) : "";
      if (!title) throw new Error("The title must contain printable text");
      pi.setSessionName(title);
      return {
        content: [{ type: "text", text: "Chat title updated." }],
        details: undefined,
      };
    },
  });
  pi.registerTool({
    name: SCHEDULE_TOOL,
    label: "Schedule",
    description:
      "Schedule a prompt to be sent to this same chat later, as if the person typed it: once (in_minutes or at) or repeating (cron, five fields, the server's local time). PiSpark asks the person before adding it. Also lists or removes this chat's schedules.",
    parameters: Type.Object(
      {
        action: Type.Union([Type.Literal("add"), Type.Literal("list"), Type.Literal("remove")]),
        prompt: Type.Optional(Type.String({ maxLength: 8192, description: "What to send at that time, written as the person's request." })),
        cron: Type.Optional(Type.String({ maxLength: 100, description: "Repeating: minute hour day-of-month month day-of-week, e.g. '0 9 * * 1-5'." })),
        in_minutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 525600, description: "Once, this many minutes from now." })),
        at: Type.Optional(Type.String({ maxLength: 40, description: "Once, at this local date and time, e.g. '2026-11-14T09:00'." })),
        id: Type.Optional(Type.String({ maxLength: 64, description: "The schedule to remove." })),
        run: Type.Optional(
          Type.Union([Type.Literal("here"), Type.Literal("new")], {
            description: "add: 'here' sends each run to this chat (default); 'new' starts each run as a new session under this chat.",
          }),
        ),
        report: Type.Optional(
          Type.Union([Type.Literal("result"), Type.Literal("status"), Type.Literal("none")], {
            description:
              "add, with run 'new': how each run tells this chat it ended. 'status' (default): a line here, and the run can raise what needs attention; 'result': its answer wakes this chat; 'none': nothing.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_id, parameters, signal) {
      if (signal?.aborted) throw new Error("Cancelled");
      let request: ScheduleRequest;
      if (parameters.action === "list") request = { action: "list" };
      else if (parameters.action === "remove") {
        if (!parameters.id) throw new Error("Give the id of the schedule to remove (list shows them)");
        request = { action: "remove", id: parameters.id };
      } else {
        const whens = [parameters.cron, parameters.in_minutes, parameters.at].filter((value) => value !== undefined);
        if (whens.length !== 1) throw new Error("Give exactly one of cron, in_minutes or at");
        if (!parameters.prompt?.trim()) throw new Error("Give the prompt to send");
        const at =
          parameters.in_minutes !== undefined
            ? new Date(Date.now() + parameters.in_minutes * 60_000).toISOString()
            : parameters.at !== undefined
              ? new Date(parameters.at).toISOString()
              : undefined;
        if (parameters.at !== undefined && Number.isNaN(new Date(parameters.at).getTime())) throw new Error("at is not a date and time");
        request = {
          action: "add",
          input: {
            prompt: parameters.prompt,
            ...(at ? { at } : { cron: parameters.cron }),
            ...(parameters.run ? { run: parameters.run } : {}),
            ...(parameters.report ? { report: parameters.report } : {}),
          },
        };
      }
      const answer = await new Promise<{ ok: boolean; text: string }>((reply) => {
        const message: ScheduleMessage = { request, reply };
        pi.events.emit(SCHEDULE_CHANNEL, message);
        // The host takes the request while the event is delivered; nobody did: not hosted by PiSpark.
        if (!message.taken) reply({ ok: false, text: "Scheduling is not available here." });
      });
      if (!answer.ok) throw new Error(answer.text);
      return { content: [{ type: "text", text: answer.text }], details: undefined };
    },
  });
  pi.registerTool({
    name: SESSION_TOOL,
    label: "Start other sessions",
    description:
      "Hand work to another PiSpark session that runs on its own while this one carries on: start one with a first message (and optionally a persona, a title and how it reports), list this session's sessions, send one another message, stop one, or read its last answer. By default a session you started sends its answer here as a new message when it finishes. Sessions started by another session cannot start sessions.",
    parameters: Type.Object(
      {
        action: Type.Union([Type.Literal("start"), Type.Literal("list"), Type.Literal("send"), Type.Literal("stop"), Type.Literal("read")]),
        prompt: Type.Optional(Type.String({ maxLength: 65536, description: "start: the new session's first message, complete on its own." })),
        title: Type.Optional(Type.String({ maxLength: 200, description: "start: a short title for the new session." })),
        persona: Type.Optional(Type.String({ maxLength: 64, description: "start: a persona id; this session's persona when left out." })),
        report: Type.Optional(
          Type.Union([Type.Literal("result"), Type.Literal("status"), Type.Literal("none")], {
            description:
              "start: how it tells this session it ended. 'result' (default): its answer arrives here; 'status': only a line saying it ended, and it can raise what needs attention; 'none': nothing.",
          }),
        ),
        id: Type.Optional(Type.String({ maxLength: 64, description: "send, stop, read: the session (list shows them)." })),
        text: Type.Optional(Type.String({ maxLength: 65536, description: "send: the message." })),
      },
      { additionalProperties: false },
    ),
    async execute(_id, parameters, signal) {
      if (signal?.aborted) throw new Error("Cancelled");
      const { action } = parameters;
      let request: SessionRequest;
      if (action === "list") request = { action };
      else if (action === "start") {
        if (!parameters.prompt?.trim()) throw new Error("Give the first message for the new session");
        request = {
          action,
          prompt: parameters.prompt,
          ...(parameters.persona ? { persona: parameters.persona } : {}),
          ...(parameters.title ? { title: parameters.title } : {}),
          ...(parameters.report ? { report: parameters.report } : {}),
        };
      } else {
        if (!parameters.id) throw new Error("Give the id of the session (list shows them)");
        if (action === "send") {
          if (!parameters.text?.trim()) throw new Error("Give the message to send");
          request = { action, id: parameters.id, text: parameters.text };
        } else request = { action, id: parameters.id };
      }
      const answer = await new Promise<{ ok: boolean; text: string }>((reply) => {
        const message: SessionMessage = { request, reply };
        pi.events.emit(SESSION_CHANNEL, message);
        if (!message.taken) reply({ ok: false, text: "Starting sessions is not available here." });
      });
      if (!answer.ok) throw new Error(answer.text);
      return { content: [{ type: "text", text: answer.text }], details: undefined };
    },
  });
  pi.registerTool({
    name: PROCESS_TOOL,
    label: "Run in the background",
    description:
      "Run a command in the background on this host (a dev server, a build, a test suite), owned by PiSpark so it keeps running while this session is idle or unloaded. start returns at once with its id and first output; with wait_for (a regular expression) and timeout_seconds it returns when the output shows it or the time is up. output returns what you have not read yet, optionally waiting the same way. watch wakes this session when a line matches a pattern. When a process ends this session is told: 'result' (default) wakes it with the exit code and last output; 'status' adds a line; 'none' says nothing. Also lists and stops this session's processes and those of sessions it started.",
    parameters: Type.Object(
      {
        action: Type.Union([Type.Literal("start"), Type.Literal("list"), Type.Literal("output"), Type.Literal("watch"), Type.Literal("unwatch"), Type.Literal("stop")]),
        command: Type.Optional(Type.String({ maxLength: 8192, description: "start: the shell command." })),
        folder: Type.Optional(Type.String({ maxLength: 4096, description: "start: where to run it; this session's folder when left out." })),
        title: Type.Optional(Type.String({ maxLength: 120, description: "start: a short name." })),
        report: Type.Optional(
          Type.Union([Type.Literal("result"), Type.Literal("status"), Type.Literal("none")], {
            description: "start, watch: how this session is told. Use 'status' for servers that only end when stopped or broken.",
          }),
        ),
        wait_for: Type.Optional(Type.String({ maxLength: 200, description: "start, output: a regular expression to wait for in the output, e.g. 'ready|listening'. Needs timeout_seconds." })),
        timeout_seconds: Type.Optional(Type.Number({ minimum: 1, maximum: 3600, description: "With wait_for: the longest to wait." })),
        stop_after_seconds: Type.Optional(Type.Number({ minimum: 1, maximum: 604800, description: "start: stop it after this long. Without it, it runs until it ends or is stopped." })),
        id: Type.Optional(Type.String({ maxLength: 64, description: "output, watch, unwatch, stop: the process (list shows them)." })),
        pattern: Type.Optional(Type.String({ maxLength: 200, description: "watch, unwatch: a regular expression, e.g. 'error|failed'." })),
      },
      { additionalProperties: false },
    ),
    async execute(_id, parameters, signal) {
      if (signal?.aborted) throw new Error("Cancelled");
      const p = parameters;
      if ((p.wait_for === undefined) !== (p.timeout_seconds === undefined)) throw new Error("A wait needs both wait_for and timeout_seconds");
      const wait = p.wait_for !== undefined ? { waitFor: p.wait_for, timeoutSeconds: p.timeout_seconds! } : {};
      const need = (value: string | undefined, what: string) => {
        if (!value?.trim()) throw new Error(`Give ${what}`);
        return value;
      };
      let request: ProcessRequest;
      if (p.action === "list") request = { action: "list" };
      else if (p.action === "start")
        request = {
          action: "start",
          command: need(p.command, "the command"),
          ...(p.folder ? { folder: p.folder } : {}),
          ...(p.title ? { title: p.title } : {}),
          ...(p.report ? { report: p.report } : {}),
          ...(p.stop_after_seconds ? { stopAfterSeconds: p.stop_after_seconds } : {}),
          ...wait,
        };
      else if (p.action === "output") request = { action: "output", id: need(p.id, "the id (list shows them)"), ...wait };
      else if (p.action === "watch")
        request = { action: "watch", id: need(p.id, "the id"), pattern: need(p.pattern, "the pattern"), ...(p.report ? { report: p.report } : {}) };
      else if (p.action === "unwatch") request = { action: "unwatch", id: need(p.id, "the id"), pattern: need(p.pattern, "the pattern") };
      else request = { action: "stop", id: need(p.id, "the id") };
      const answer = await new Promise<{ ok: boolean; text: string }>((reply) => {
        const message: ProcessMessage = { request, reply, ...(signal ? { signal } : {}) };
        pi.events.emit(PROCESS_CHANNEL, message);
        if (!message.taken) reply({ ok: false, text: "Background processes are not available here." });
      });
      if (!answer.ok) throw new Error(answer.text);
      return { content: [{ type: "text", text: answer.text }], details: undefined };
    },
  });
  pi.registerTool({
    name: REPORT_TOOL,
    label: "Raise with the starting session",
    description:
      "This session was started by another session, which hears only that it ended. When you find something that session needs to know or act on, raise it with this tool: your text wakes it.",
    parameters: Type.Object({ text: Type.String({ maxLength: 65536, description: "What the starting session needs to know, complete on its own." }) }, { additionalProperties: false }),
    async execute(_id, parameters, signal) {
      if (signal?.aborted) throw new Error("Cancelled");
      if (!parameters.text?.trim()) throw new Error("Give what to raise");
      const answer = await new Promise<{ ok: boolean; text: string }>((reply) => {
        const message: SessionMessage = { request: { action: "report", text: parameters.text }, reply };
        pi.events.emit(SESSION_CHANNEL, message);
        if (!message.taken) reply({ ok: false, text: "Raising is not available here." });
      });
      if (!answer.ok) throw new Error(answer.text);
      return { content: [{ type: "text", text: answer.text }], details: undefined };
    },
  });
  pi.on("before_agent_start", (event) => {
    const active = pi.getActiveTools();
    const guidance = [
      active.includes(TITLE_TOOL)
        ? "PiSpark hosts this chat. Use pispark_set_title to give it a short, meaningful title when its purpose is clear; update only when the topic meaningfully changes."
        : "",
      active.includes(SCHEDULE_TOOL)
        ? `When the person asks to do something later or repeatedly in this chat, use pispark_schedule; PiSpark asks them to confirm. The server's local time now is ${localNow()}.`
        : "",
      active.includes(SESSION_TOOL)
        ? "For work that can run on its own (research, a long job, one of several parallel parts), you may start other sessions with pispark_session and carry on. Each session's answer arrives later as a message here; when others are still running, acknowledge it in one line."
        : "",
      active.includes(PROCESS_TOOL)
        ? "For commands that run long or never end on their own (dev servers, watchers, long builds or test runs), use pispark_process instead of bash: it runs them in the background and tells you when they end. Wait for a server with wait_for and timeout_seconds; read new output with output."
        : "",
      active.includes(REPORT_TOOL)
        ? "Another session started this one and hears only that it ended. If you find something it needs to know or act on, raise it with pispark_report; otherwise just finish."
        : "",
    ].filter(Boolean);
    if (!guidance.length) return;
    event.systemPromptOptions.appendSystemPrompt = [event.systemPromptOptions.appendSystemPrompt, ...guidance]
      .filter(Boolean)
      .join("\n\n");
  });
}
