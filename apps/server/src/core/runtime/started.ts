import type { Answer, Verb } from "../../contract/verbs.js";
import type { Schedule } from "../../contract/schedule-protocol.js";
import { describeSchedule } from "../../contract/cron.js";
import type { Children } from "./children.js";
import type { Handles } from "./handles.js";
import type { SessionAccess } from "./session-access.js";
import type { SessionProcesses } from "./session-processes.js";
import type { Wake } from "./wakes.js";
import { pattern } from "./verbs.js";

/** One thing a session started, as `look` lists it: how it reads, and whether it is still open. */
export interface Listed {
  id: string;
  line: string;
  open: boolean;
}
/** A child's answer as a wait takes it: the words for the agent, and for extensions how it ended, what it said and the data its side attached. */
export interface Taken {
  words: string;
  how?: string;
  text?: string;
  data?: unknown;
}
type Fields<V extends Verb["verb"]> = Omit<Extract<Verb, { verb: V }>, "verb">;

/**
 * A kind of thing a session can start: a session, a process, a schedule. Each keeps the same
 * contract (it belongs to the session that started it, has a state, can be looked at and stopped,
 * and gives one answer when it is done), so every verb but its own start works on any kind, and a
 * new kind needs only its own start.
 */
export interface Kind {
  /** The word its handles begin with: `session`, as in `session-1`. */
  readonly name: string;
  /** What `owner` started of this kind, oldest first. */
  of(owner: string): Listed[];
  look(owner: string, id: string, find?: string): Promise<Answer>;
  stop(owner: string, id: string, signal?: AbortSignal): Promise<Answer>;
  /** Tells it something. A kind that cannot be told leaves this out. */
  send?(owner: string, id: string, message: Omit<Fields<"send">, "id">): Promise<Answer>;
  /**
   * Its answer once it is done (or, with `until`, once its output shows that), taken so it is not
   * delivered again; undefined when `signal` ends the wait first. A kind that is not waited for
   * leaves this out.
   */
  wait?(owner: string, id: string, until: RegExp | undefined, signal: AbortSignal): Promise<Taken | undefined>;
}

/**
 * What a session says about the things it started: each kind's own start, what goes up, and the
 * verbs every kind shares (look, stop, send and wait), which find the child by its handle.
 */
export class Started {
  private readonly kinds: Kind[];
  /** Sessions with a wait under way, and how many. */
  private readonly waits = new Map<string, number>();

  constructor(
    private readonly handles: Handles,
    private readonly children: Children,
    private readonly processes: SessionProcesses,
    schedules: Kind,
    /** What waits for a session while it works, and what arrives for it. */
    private readonly inbox: Pick<SessionAccess, "take" | "arrival" | "drain">,
  ) {
    this.kinds = [children, processes, schedules];
  }

  /** One verb, from a session's agent or an extension in it. */
  say(owner: string, verb: Exclude<Verb, { verb: "self" | "schedule" }>, signal?: AbortSignal): Promise<Answer> {
    switch (verb.verb) {
      case "start_session":
        return this.children.start(owner, verb);
      case "start_process":
        return this.processes.start(owner, verb, signal);
      case "raise":
      case "note":
        return this.children.up(owner, verb.verb, verb.text, verb.data);
      case "send":
        return this.send(owner, verb);
      case "wait":
        return this.waited(owner, verb, signal);
      case "look":
        return this.look(owner, verb);
      case "stop":
        return this.stop(owner, verb, signal);
    }
  }

  /** Whether a wait is under way in the session: what arrives for it then waits to be taken, whether or not a turn runs. */
  waiting(owner: string): boolean {
    return this.waits.has(owner);
  }
  private async waited(owner: string, verb: Fields<"wait">, signal?: AbortSignal): Promise<Answer> {
    this.waits.set(owner, (this.waits.get(owner) ?? 0) + 1);
    try {
      return await this.wait(owner, verb, signal);
    } finally {
      const left = this.waits.get(owner)! - 1;
      if (left) this.waits.set(owner, left);
      else this.waits.delete(owner);
      // What the wait did not take is sent now, if nothing else holds it back.
      this.inbox.drain();
    }
  }

  /** What a handle names among the things `owner` started. */
  private find(owner: string, handle: string): { kind: Kind; id: string } | undefined {
    const found = this.handles.find(owner, handle);
    const kind = found && this.kinds.find((each) => each.name === found.kind);
    return kind ? { kind, id: found!.id } : undefined;
  }
  private all(owner: string) {
    return this.kinds.flatMap((kind) => kind.of(owner).map((each) => ({ ...each, kind, handle: this.handles.of(owner, kind.name, each.id) })));
  }
  private readonly unknown: Answer = { ok: false, text: "This session started nothing with that id (pispark_look lists what it started)." };

  private async look(owner: string, { id, find }: Fields<"look">): Promise<Answer> {
    if (id === undefined) {
      const all = this.all(owner);
      return { ok: true, text: all.length ? all.map((each) => `${each.handle}: ${each.line}`).join("\n") : "This session has not started anything." };
    }
    const found = this.find(owner, id);
    return found ? found.kind.look(owner, found.id, find) : this.unknown;
  }

  private async stop(owner: string, { id }: Fields<"stop">, signal?: AbortSignal): Promise<Answer> {
    const found = this.find(owner, id);
    return found ? found.kind.stop(owner, found.id, signal) : this.unknown;
  }

  private async send(owner: string, { id, ...message }: Fields<"send">): Promise<Answer> {
    const found = this.find(owner, id);
    if (!found) return this.unknown;
    return found.kind.send ? found.kind.send(owner, found.id, message) : { ok: false, text: `A ${found.kind.name} cannot be sent to.` };
  }

  /**
   * Waits for children and takes their answers: all of them, or the first (`for: "any"`). It can
   * never trap its session: it ends early on what needs the session now (something it started
   * raises, or a message from above reaches it), when `seconds` are up, or when `signal` aborts.
   * It then says what is still open. What it returns is taken, and not sent to the session as well.
   */
  private async wait(owner: string, verb: Fields<"wait">, signal?: AbortSignal): Promise<Answer> {
    const all = this.all(owner);
    const targets = verb.ids ? verb.ids.map((handle) => all.find((each) => each.handle === handle) ?? handle) : all.filter((each) => each.open && each.kind.wait);
    if (targets.some((each) => typeof each === "string")) return this.unknown;
    const waited = (targets as (typeof all)[number][]).filter((each) => each.kind.wait);
    if (!waited.length) return { ok: true, text: verb.ids ? "None of those can be waited for." : "Nothing this session started is still open." };
    const raise = (wake: Wake) => wake.word === "raise";
    // A raise that was already waiting is what the session needs first.
    const raised = this.inbox.take(owner, raise);
    const answers = new Map<string, Taken>();
    let early: string | undefined;
    if (raised.length) early = RAISED;
    else {
      const over = new AbortController();
      const end = (why?: string) => ((early ??= why), over.abort());
      const cancelled = () => end("The wait was cancelled.");
      signal?.addEventListener("abort", cancelled, { once: true });
      if (signal?.aborted) cancelled();
      const timer = verb.seconds === undefined ? undefined : setTimeout(() => end(`Not in within ${verb.seconds} s.`), verb.seconds * 1000);
      void this.needed(owner, over.signal).then((why) => why && end(why));
      const until = verb.until === undefined ? undefined : pattern(verb.until);
      const each = waited.map(async (target) => {
        const answer = await target.kind.wait!(owner, target.id, until, over.signal);
        if (answer !== undefined) answers.set(target.handle, answer);
      });
      try {
        await (verb.for === "any" ? Promise.race(each) : Promise.all(each));
        // The first is in (or all are): the rest stop waiting, and stay open.
        end();
        await Promise.all(each);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancelled);
      }
      raised.push(...this.inbox.take(owner, raise));
    }
    const open = waited.filter((target) => !answers.has(target.handle)).map((target) => target.handle);
    const closing = [early, open.length ? `Still open: ${open.join(", ")}.` : ""].filter(Boolean).join(" ");
    const taken = waited.flatMap((target) => (answers.has(target.handle) ? [[target.handle, answers.get(target.handle)!] as const] : []));
    return {
      ok: true,
      text: [...taken.map(([handle, answer]) => `${handle}: ${answer.words}`), ...raised.map((wake) => wake.text), closing].filter(Boolean).join("\n\n"),
      // The same, for an extension: each answer by its handle, what was raised, and what is still open.
      data: {
        answers: Object.fromEntries(taken.map(([handle, { words: _words, ...answer }]) => [handle, answer])),
        raised: raised.map((wake) => ({ id: this.handles.of(owner, wake.source.kind, wake.source.id), text: wake.report?.text ?? wake.text, ...(wake.report?.data !== undefined ? { data: wake.report.data } : {}) })),
        open,
      },
    };
  }

  /** Resolves with why, once something needs the session now; undefined when `signal` ends it first. */
  private async needed(owner: string, signal: AbortSignal): Promise<string | undefined> {
    for (;;) {
      const what = await this.inbox.arrival(owner, signal);
      if (what === undefined) return undefined;
      if (what === "message") return "The wait ended early: a message arrived for this session.";
      if (what.word === "raise") return RAISED;
    }
  }
}

const RAISED = "The wait ended early: something this session started raised (above).";

/** Schedules as a kind: looked at and stopped (removed) like anything else a session started. Each run of one is waited for, not the schedule. */
export function scheduleKind(schedules: { of(sessionId: string): Schedule[]; remove(id: string): void }): Kind {
  const line = (s: Schedule) => `${describeSchedule(s)}, ${s.run === "new" ? "each run in a new session" : "in this session"} (${s.on ? "on" : "off"}): ${s.prompt}`;
  const mine = (owner: string, id: string) => schedules.of(owner).find((s) => s.id === id);
  const gone: Answer = { ok: false, text: "This session has no schedule with that id." };
  return {
    name: "schedule",
    of: (owner) => schedules.of(owner).map((s) => ({ id: s.id, line: line(s), open: s.on })),
    async look(owner, id) {
      const s = mine(owner, id);
      if (!s) return gone;
      const runs = s.runs.map((run) => `${run.at}: ${run.outcome}${run.reason ? ` (${run.reason})` : ""}`);
      return { ok: true, text: [line(s), s.next ? `Next: ${s.next}` : "", runs.length ? `Last runs:\n${runs.join("\n")}` : "It has not run yet."].filter(Boolean).join("\n") };
    },
    async stop(owner, id) {
      if (!mine(owner, id)) return gone;
      schedules.remove(id);
      return { ok: true, text: "Schedule removed." };
    },
  };
}
