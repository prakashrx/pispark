import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { chatTitle } from "../../contract/chat-title.js";
import { TITLE_TOOL } from "../runtime/chat-title.js";
import { SCHEDULE_CHANNEL, SCHEDULE_TOOL, type ScheduleMessage, type ScheduleRequest } from "../runtime/schedule-tool.js";

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
 * schedule tool asks PiSpark (which asks the person first) to wake this session later.
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
        request = { action: "add", input: { prompt: parameters.prompt, ...(at ? { at } : { cron: parameters.cron }) } };
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
  pi.on("before_agent_start", (event) => {
    const active = pi.getActiveTools();
    const guidance = [
      active.includes(TITLE_TOOL)
        ? "PiSpark hosts this chat. Use pispark_set_title to give it a short, meaningful title when its purpose is clear; update only when the topic meaningfully changes."
        : "",
      active.includes(SCHEDULE_TOOL)
        ? `When the person asks to do something later or repeatedly in this chat, use pispark_schedule; PiSpark asks them to confirm. The server's local time now is ${localNow()}.`
        : "",
    ].filter(Boolean);
    if (!guidance.length) return;
    event.systemPromptOptions.appendSystemPrompt = [event.systemPromptOptions.appendSystemPrompt, ...guidance]
      .filter(Boolean)
      .join("\n\n");
  });
}
