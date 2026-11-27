/**
 * What a session says to PiSpark about the things it started: ten verbs, one per word of the
 * language (docs/session-runtime.md#the-ten-verbs). A child is anything the session started, of
 * any kind; every verb but a start works on any child.
 *
 * The verbs travel on the session's own Pi event bus as `VerbMessage`s on `VERB_CHANNEL`. The
 * built-in tools send exactly these (a tool is a schema and one call), and an extension in the
 * session may send the same, with the same rights: only what its own session started.
 */
export const VERB_CHANNEL = "pispark:verb";

export const VERBS = ["start_session", "start_process", "schedule", "send", "wait", "look", "stop", "raise", "note", "self"] as const;
export type VerbName = (typeof VERBS)[number];
/** The built-in tool that says a verb. */
export const toolOf = (verb: VerbName) => `pispark_${verb}` as const;

/** A request: the verb and its fields, named as the tool's parameters are. */
export type Verb =
  /** Ask: hand work to a new session. `brief` is its first message, complete on its own. */
  | { verb: "start_session"; brief: string; title?: string; agent?: string }
  /** Ask: run a command in the background. `raise_on`: a regular expression; a matching line of output is raised. */
  | { verb: "start_process"; command: string; title?: string; folder?: string; stop_after_seconds?: number; raise_on?: string }
  /** Ask, with a time: send `prompt` later, once (`in_minutes` or `at`) or repeating (`cron`). The person is asked first. */
  | { verb: "schedule"; prompt: string; cron?: string; in_minutes?: number; at?: string; run?: "here" | "new" }
  /** Tell: `text` to a session (`now`: at its next pause; `after`: when it has finished), or a new `raise_on` for a process ("" clears it). */
  | { verb: "send"; id: string; text?: string; raise_on?: string; when?: "now" | "after" }
  /** Wait for children (everything still open when `ids` is left out) and take their answers. */
  | { verb: "wait"; ids?: string[]; for?: "all" | "any"; until?: string; seconds?: number }
  /** Look, without disturbing: everything this session started, or one child. `find`: literal text in a process's output. */
  | { verb: "look"; id?: string; find?: string }
  | { verb: "stop"; id: string }
  /** Up, to whoever asked: "I need you". */
  | { verb: "raise"; text: string }
  /** Up, to whoever asked: a line that never interrupts. */
  | { verb: "note"; text: string }
  /** The calling session itself. */
  | { verb: "self"; action: "inspect" | "reload" };

/** PiSpark's answer: text for the agent, and for clients what the text names, as the tool call's `details`. */
export interface Answer {
  ok: boolean;
  text: string;
  details?: Record<string, unknown>;
}
/** What the bus carries: the request, and where its answer goes. */
export interface VerbMessage {
  request: Verb;
  reply: (answer: Answer) => void;
  /** Ends a wait early, such as when the agent's turn is cancelled. */
  signal?: AbortSignal;
  /** Set by PiSpark while the event is delivered; nobody took it: not hosted by PiSpark. */
  taken?: boolean;
}

type Fields<V extends VerbName> = Omit<Extract<Verb, { verb: V }>, "verb">;

/**
 * The ten verbs as functions over a session's bus (`pi.events`), named after the tools. Each sends
 * one message and resolves with PiSpark's answer; where nothing answers (terminal Pi) it says so.
 */
export function verbs(events: { emit(channel: string, data: unknown): void }) {
  const say = (request: Verb, signal?: AbortSignal) =>
    new Promise<Answer>((reply) => {
      const message: VerbMessage = { request, reply, ...(signal ? { signal } : {}) };
      events.emit(VERB_CHANNEL, message);
      if (!message.taken) reply({ ok: false, text: "Not available here: this session is not hosted by PiSpark." });
    });
  return {
    say,
    startSession: (fields: Fields<"start_session">) => say({ verb: "start_session", ...fields }),
    startProcess: (fields: Fields<"start_process">) => say({ verb: "start_process", ...fields }),
    schedule: (fields: Fields<"schedule">) => say({ verb: "schedule", ...fields }),
    send: (fields: Fields<"send">) => say({ verb: "send", ...fields }),
    wait: (fields: Fields<"wait"> = {}, signal?: AbortSignal) => say({ verb: "wait", ...fields }, signal),
    look: (fields: Fields<"look"> = {}) => say({ verb: "look", ...fields }),
    stop: (id: string) => say({ verb: "stop", id }),
    raise: (text: string) => say({ verb: "raise", text }),
    note: (text: string) => say({ verb: "note", text }),
    self: (action: Fields<"self">["action"]) => say({ verb: "self", action }),
  };
}

/**
 * An extension in a child session sets the data its answer carries (JSON, at most 64 KiB), such
 * as what its own tool collected: `pi.events.emit(RESULT_CHANNEL, { data })`. The last one counts.
 */
export const RESULT_CHANNEL = "pispark:result";
/**
 * Emitted on a parent's bus when one of its children answered or raised something, before anything
 * reaches the parent's agent. An extension may `reply({ action: "skip" })` (it handled it; the agent
 * is not woken) or `reply({ action: "send", text })` (what the agent gets instead), synchronously.
 */
export const CHILD_ENDED_CHANNEL = "pispark:child-ended";
export interface ChildEnded {
  /** The child, how it reads, and how it ended ("finished", "stopped", "failed" or "raised"). */
  session: string;
  title: string;
  how: string;
  /** Its answer (or what it raised), and the data an extension in it set. */
  text: string;
  data?: unknown;
  reply: (answer: { action: "skip" } | { action: "send"; text: string }) => void;
}
