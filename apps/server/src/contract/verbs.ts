import type { AgentDefinition } from "./agent-protocol.js";

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

/**
 * Whoever asked gets the answer. An agent's asks are answered to the agent: what it does not take
 * in its turn (with `wait` or `look`) is sent to it when the turn ends. Code that asks outside a
 * turn has no turn to end, so it says `collect: true`: the child's answer and raises then wait
 * until that code takes them, and never wake the agent.
 */
export interface Collect {
  collect?: boolean;
}

/** A request: the verb and its fields, named as the tool's parameters are. */
export type Verb =
  /**
   * Ask: hand work to a new session, set up as the person sets one up. `brief` is its first
   * message, complete on its own. `agent`: an agent's id, or an agent definition made for this
   * session (kept as its own layer); the Default agent when left out. `folder`: where it works;
   * the caller's when left out. `model`: `provider/id`; the agent's own when left out.
   * `collect`: for code that takes the answer itself, see `Collect`.
   */
  | ({ verb: "start_session"; brief: string; title?: string; agent?: string | AgentDefinition; folder?: string; model?: string; data?: unknown } & Collect)
  /** Ask: run a command in the background. `raise_on`: a regular expression; a matching line of output is raised. */
  | ({ verb: "start_process"; command: string; title?: string; folder?: string; stop_after_seconds?: number; raise_on?: string } & Collect)
  /** Ask, with a time: send `prompt` later, once (`in_minutes` or `at`) or repeating (`cron`). The person is asked first. */
  | { verb: "schedule"; prompt: string; cron?: string; in_minutes?: number; at?: string; run?: "here" | "new" }
  /** Tell: `text` to a session (`now`: at its next pause; `after`: when it has finished), or a new `raise_on` for a process ("" clears it). */
  | { verb: "send"; id: string; text?: string; raise_on?: string; when?: "now" | "after"; data?: unknown }
  /** Wait for children (everything still open when `ids` is left out) and take their answers. */
  | { verb: "wait"; ids?: string[]; for?: "all" | "any"; until?: string; seconds?: number }
  /** Look, without disturbing: everything this session started, or one child. `find`: literal text in a process's output. */
  | { verb: "look"; id?: string; find?: string }
  | { verb: "stop"; id: string }
  /** Up, to whoever asked: "I need you". */
  | { verb: "raise"; text: string; data?: unknown }
  /** Up, to whoever asked: a line that never interrupts. */
  | { verb: "note"; text: string; data?: unknown }
  /** The calling session itself. */
  | { verb: "self"; action: "inspect" | "reload" };

/**
 * PiSpark's answer: text for the agent; for clients what the text names, as the tool call's
 * `details`; and for extensions what the text says, as `data`: a start's `{ id }` (the handle), a
 * wait's `{ answers, raised, open }`, and for a start refused over its agent, `{ agents }`: the
 * ones there are, each `{ id, name }`.
 */
export interface Answer {
  ok: boolean;
  text: string;
  details?: Record<string, unknown>;
  data?: unknown;
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
    raise: (text: string, data?: unknown) => say({ verb: "raise", text, ...(data !== undefined ? { data } : {}) }),
    note: (text: string, data?: unknown) => say({ verb: "note", text, ...(data !== undefined ? { data } : {}) }),
    self: (action: Fields<"self">["action"]) => say({ verb: "self", action }),
  };
}

/**
 * Text for agents, data for extensions. An extension in a child session sets the data its answer
 * carries (JSON, at most 64 KiB), such as what its own tool collected:
 * `pi.events.emit(RESULT_CHANNEL, { data })`. The last one counts. A raise and a note carry
 * theirs in the verb (`data`), and so do a brief and a send, down to the child's extensions.
 */
export const RESULT_CHANNEL = "pispark:result";
/**
 * An extension asks for the ten verbs as functions (`verbs` above), bound to its session:
 * `pi.events.emit(API_CHANNEL, (api) => { host = api; })`. PiSpark calls back at once. Outside
 * PiSpark nobody does, and the extension carries on without them. The functions only send the
 * `VERB_CHANNEL` messages, which stay the contract.
 */
export const API_CHANNEL = "pispark:api";
export type Verbs = ReturnType<typeof verbs>;
/**
 * Emitted on a session's bus for whatever reaches the session, before its agent hears of it: an
 * answer, a raise or a note from something it started, or an ask or a tell from the session that
 * started it. An extension may reply, synchronously: `{ action: "skip" }` (it handled it: the
 * agent takes no turn, and no line is added) or `{ action: "send", text }` (what the agent gets
 * instead). Without a reply it goes through as it is. The person's own messages are not here:
 * Pi's `input` event is for those.
 */
export const HEARD_CHANNEL = "pispark:heard";
export interface Heard {
  word: "ask" | "tell" | "answer" | "raise" | "note";
  /** Who said it: something this session started, by its handle, or the session that started this one. */
  from: { id?: string; kind: "session" | "process" | "parent"; title: string };
  /** For an answer, how it ended: "finished", "stopped", "failed", "exited 0". */
  how?: string;
  text: string;
  /** What an extension on the other side attached. */
  data?: unknown;
  reply: (answer: { action: "skip" } | { action: "send"; text: string }) => void;
}
