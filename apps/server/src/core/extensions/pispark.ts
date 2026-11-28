import { dirname, join } from "node:path";
import { Type, type TSchema } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sessionTitle } from "../../contract/session-title.js";
import { toolOf, verbs, type Verb, type VerbName } from "../../contract/verbs.js";
import { registerExtensionTool } from "../runtime/extension-tool.js";
import { TITLE_TOOL } from "../runtime/session-title.js";

/** "2026-11-13 14:30 (UTC+01:00)": the server's local time, for the agent to schedule by. */
function localNow(now = new Date()): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const zone = `UTC${offset < 0 ? "-" : "+"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} (${zone})`;
}

/**
 * Ordinary native Pi extension, instantiated separately for every hosted session. Its title tool
 * names the session with Pi's own `setSessionName`; the session's name is the session title. Its
 * other tools are the ten verbs a session says about what it started (`contract/verbs.ts`).
 */
export default function pispark(pi: ExtensionAPI): void {
  registerExtensionTool(pi);
  pi.registerTool({
    name: TITLE_TOOL,
    label: "Set session title",
    description:
      "Give this session a short, meaningful title when its purpose is clear. Update it only when the topic meaningfully changes.",
    parameters: Type.Object(
      { title: Type.String({ maxLength: 4096 }) },
      { additionalProperties: false },
    ),
    async execute(_id, parameters, signal) {
      if (signal?.aborted) throw new Error("Cancelled");
      const title = typeof parameters.title === "string" && parameters.title.length <= 4096 ? sessionTitle(parameters.title) : "";
      if (!title) throw new Error("The title must contain printable text");
      pi.setSessionName(title);
      return {
        content: [{ type: "text", text: "Session title updated." }],
        details: undefined,
      };
    },
  });
  // The ten verbs about what a session started (`contract/verbs.ts`): each tool is a schema and one call.
  const say = verbs(pi.events);
  const tool = (verb: VerbName, label: string, description: string, properties: Record<string, TSchema>) =>
    pi.registerTool({
      name: toolOf(verb),
      label,
      description,
      parameters: Type.Object(properties, { additionalProperties: false }),
      async execute(_id, parameters, signal) {
        if (signal?.aborted) throw new Error("Cancelled");
        const answer = await say.say({ verb, ...parameters } as Verb, signal);
        if (!answer.ok) throw new Error(answer.text);
        return { content: [{ type: "text", text: answer.text }], details: answer.details };
      },
    });
  const id = (what: string) => Type.String({ maxLength: 64, description: `${what}, by its id, such as session-1 or process-2 (pispark_look lists them).` });
  const pattern = (description: string) => Type.String({ maxLength: 200, description });

  tool(
    "start_session",
    "Start a session",
    "Hand work to another PiSpark session, which runs on its own while this one carries on. It sees only the brief. It answers once, when it is done, and its answer arrives here as a message. It is then put away, unless you keep it. Set it up as a person sets up a new session: a folder, an agent and a model.",
    {
      brief: Type.String({ maxLength: 65536, description: "Its first message, complete on its own: the outcome, the limits, and what done means." }),
      title: Type.Optional(Type.String({ maxLength: 200, description: "A short title for it; named from the brief when left out." })),
      agent: Type.Optional(
        Type.Union([Type.String({ maxLength: 64 }), Type.Object({}, { additionalProperties: true })], {
          description:
            "An agent id, or an agent definition made for this session, in the shape of an agent.json (base, on, off, resources, settings): it names agents, skills, extensions and prompts that exist, and holds no code. The Default agent when left out.",
        }),
      ),
      folder: Type.Optional(Type.String({ maxLength: 4096, description: "Where it works, absolute or relative to this session's folder; this session's folder when left out." })),
      model: Type.Optional(Type.String({ maxLength: 400, description: "As provider/id; its agent's own model when left out." })),
      keep: Type.Optional(Type.Boolean({ description: "true keeps it after its answer, so pispark_send can tell it more later with all it knows; pispark_stop then puts it away. Left out, it is put away once it is done." })),
    },
  );
  tool(
    "start_process",
    "Run in the background",
    "Run a command in the background on this host (a dev server, a build, a test suite). PiSpark owns it, so it keeps running while this session is idle. Returns at once with its id and first output. When it ends this session is told once, with its exit code and last output.",
    {
      command: Type.String({ maxLength: 8192, description: "The shell command." }),
      title: Type.Optional(Type.String({ maxLength: 120, description: "A short name." })),
      folder: Type.Optional(Type.String({ maxLength: 4096, description: "Where to run it; this session's folder when left out." })),
      stop_after_seconds: Type.Optional(Type.Number({ minimum: 1, maximum: 604800, description: "Stop it after this long. Without it, it runs until it ends or is stopped." })),
      raise_on: Type.Optional(pattern("A regular expression, e.g. 'error|failed': this session is woken when a line of its output matches, at most once a minute.")),
    },
  );
  tool(
    "schedule",
    "Schedule",
    "Schedule a prompt to be sent later, as if the person typed it: once (in_minutes or at) or repeating (cron). PiSpark asks the person before adding it.",
    {
      prompt: Type.String({ maxLength: 8192, description: "What to send at that time, written as the person's request." }),
      cron: Type.Optional(Type.String({ maxLength: 100, description: "Repeating: minute hour day-of-month month day-of-week, in the server's local time, e.g. '0 9 * * 1-5'." })),
      in_minutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 525600, description: "Once, this many minutes from now." })),
      at: Type.Optional(Type.String({ maxLength: 40, description: "Once, at this local date and time, e.g. '2026-11-14T09:00'." })),
      run: Type.Optional(
        Type.Union([Type.Literal("here"), Type.Literal("new")], { description: "'here' sends each run to this session (default); 'new' starts each run as a new session under this one." }),
      ),
    },
  );
  tool(
    "send",
    "Send",
    "Tell something this session started. A session takes text: working, it reads the text at its next pause; waiting for your answer to what it raised, or kept and at rest, it is asked anew and answers again. A process takes raise_on.",
    {
      id: id("What to tell"),
      text: Type.Optional(Type.String({ maxLength: 65536, description: "For a session: the message." })),
      raise_on: Type.Optional(pattern("For a process: a new regular expression to raise on, or '' to stop raising.")),
      when: Type.Optional(
        Type.Union([Type.Literal("now"), Type.Literal("after")], { description: "For a working session: 'now' (default) at its next pause; 'after' once it has finished what it is doing." }),
      ),
    },
  );
  tool(
    "wait",
    "Wait",
    "Wait for sessions and processes this session started, and get their answers together, rather than ending your turn or checking on them. It ends early if one of them raises something or a message arrives for you. Answers returned here are not sent again, and what is still open when the wait ends stays open.",
    {
      ids: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { minItems: 1, maxItems: 50, description: "What to wait for, such as ['session-1', 'process-2']; everything still open when left out." })),
      for: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("any")], { description: "'all' (default) waits for every one; 'any' returns when the first is in." })),
      until: Type.Optional(pattern("A regular expression: return when a process's output shows it, e.g. 'ready|listening'.")),
      seconds: Type.Optional(Type.Number({ minimum: 1, maximum: 604800, description: "Give up after this long. Without it the wait has no limit." })),
    },
  );
  tool(
    "look",
    "Look",
    "See what this session started, without disturbing it. Without id: every session, process and schedule, with its id and state. With id: a session's state, last note and what it last said; a process's unread output; a schedule's runs.",
    {
      id: Type.Optional(id("One thing to look at")),
      find: Type.Optional(Type.String({ maxLength: 200, pattern: "^[^\\r\\n]+$", description: "For a process: literal text to search for in its output, case-insensitive." })),
    },
  );
  tool("stop", "Stop", "Stop something this session started: a session and what it started, a process, or a schedule (which is removed). A session you kept that is at rest is put away.", {
    id: id("What to stop"),
  });
  tool(
    "raise",
    "Raise",
    "Say you need a decision from whoever asked for this work. It does not end your turn, and the answer arrives as a message. Use it only when the answer changes what you do next.",
    { text: Type.String({ maxLength: 65536, description: "What you need, complete on its own, with what you recommend." }) },
  );
  tool("note", "Note", "Leave a line for whoever asked for this work, such as progress worth knowing. It never interrupts anyone, and nothing comes back.", {
    text: Type.String({ maxLength: 65536, description: "The line." }),
  });
  tool(
    "self",
    "This session",
    "The calling session itself. inspect: its loaded resources, tools, extensions and recent errors. reload: restart it with its agent's current setup after you change that agent; it happens when this turn ends and you get the outcome as a new message.",
    { action: Type.Union([Type.Literal("inspect"), Type.Literal("reload")]) },
  );

  /** What PiSpark knows of this session that its agent is told: who started it, if a session did, and its own agent and model. */
  const self = async (): Promise<{ startedBy?: string; agent?: string; model?: string }> => {
    try {
      return JSON.parse((await say.self("inspect")).text) as { startedBy?: string; agent?: string; model?: string };
    } catch {
      return {};
    }
  };
  pi.on("before_agent_start", async (event, ctx) => {
    const active = pi.getActiveTools();
    const has = (verb: VerbName) => active.includes(toolOf(verb));
    const { startedBy: parent, agent, model } = await self();
    const guidance = [
      pisparkContext(ctx.sessionManager.getSessionDir()),
      active.includes(TITLE_TOOL)
        ? "PiSpark hosts this session. In your first reply, once its purpose is clear, call pispark_set_title with a short title of a few words; change it only when the topic meaningfully changes."
        : "",
      has("schedule")
        ? `When the person asks to do something later or repeatedly in this session, use pispark_schedule; PiSpark asks them to confirm. The server's local time now is ${localNow()}.`
        : "",
      has("start_session")
        ? `For work that can run on its own (research, a long job, one of several parallel parts), hand it to another session with pispark_start_session and carry on. Each session answers once, when it is done, and is then put away; start it with keep: true if you will tell it more after its answer. To use the answers in this turn, call pispark_wait (all of them, or the first with for 'any'); otherwise end your turn and each answer arrives here as a message. What this session starts gets a short id such as session-1 or process-2: pispark_look shows them, pispark_send tells one something, pispark_stop stops one.${
            agent ? ` A session you start uses the Default agent and that agent's model unless you say otherwise; this session's agent is "${agent}"${model ? ` and its model is "${model}"` : ""}, to pass when it should work as you do.` : ""
          }`
        : "",
      has("start_process")
        ? "For commands that run long or never end on their own (dev servers, watchers, long builds or test runs), use pispark_start_process instead of bash. When one ends this session is told once, so don't check on it repeatedly: pispark_wait blocks until it ends or its output shows something (until), and pispark_look is for a deliberate look at its output."
        : "",
      // What every session started by another one is told: who asked, how it talks, and its limit.
      parent !== undefined
        ? `The session "${parent}" started this one and gave it its first message. What you say when you finish is your answer to it: it is sent once, when you are done and nothing you started is still running, so stop processes you no longer need. Use pispark_note for progress worth a line, and pispark_raise only when you need a decision from it before you can go on. You cannot start sessions.`
        : has("raise")
          ? "pispark_note and pispark_raise speak to the person: a note leaves them a line, a raise says this session needs them. Use them to pass on what a session you started raised and you cannot decide, not for ordinary replies."
          : "",
    ].filter(Boolean);
    event.systemPromptOptions.appendSystemPrompt = [event.systemPromptOptions.appendSystemPrompt, ...guidance]
      .filter(Boolean)
      .join("\n\n");
  });
}

/**
 * What every PiSpark session is told, whatever its agent: where it runs and how it is seen, where
 * files for the person go, and which built-in skills say more. Short on purpose: the skills carry
 * the detail, and Pi loads them only when they are needed.
 */
function pisparkContext(sessionFolder: string): string {
  return [
    "This Pi session runs in PiSpark, not a terminal. The person may be on a phone or desktop in the same workspace. PiSpark displays GitHub Markdown (tables, task lists, footnotes, highlighted code, math in $…$ or $$…$$, Mermaid diagrams in ```mermaid blocks), inline images, file previews and rich tool results. Pi extensions can customize rendering and add views and controls.",
    `Files you make for the person to keep or open (documents, images, PDFs, data exports) go in this session's files folder: ${join(sessionFolder, "files")}. Project changes stay in the project; session-only Pi extension drafts belong in ${join(sessionFolder, "extension-drafts")}, outside the project and outside auto-loaded agent resources. Use pispark_extension apply for authorized session-only drafts.`,
    "Own the requested outcome within the user's authorization. Resolve routine failures and verify the result without asking the user to supervise retries. Pause for a genuine blocker, a consequential decision, or expanded authorization. Report verified outcomes and remaining decisions, not a running account of recoverable errors.",
    "Delegate only when it helps and the user has not asked to work directly with you. Give the worker the relevant decisions, constraints, and acceptance criteria, and independently check its result; responsibility stays with you.",
    `PiSpark's data folder is ${dirname(dirname(sessionFolder))}. Read the pispark skill for workspace settings, files, sessions and agents, or pispark-extensions before planning or writing an extension.`,
  ].join(" ");
}
