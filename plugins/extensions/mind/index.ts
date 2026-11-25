import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { audit } from "./audit.js";
import {
  ACTIVE, ACTS, CHARTER_SECTIONS, CLOSED, type Card, cardText, FOLDER, type Item, itemText, Mind, newCard, ruleText, field, shaped,
} from "./store.js";

/**
 * mind: memory and attention for any agent, kept in the place it works in. Four parts (charter,
 * contract, knowledge, work) pinned into the system prompt, written only through its tools.
 * See `.work/agent-attention-and-memory/GOAL.md` (private) and the README.
 */

const GUIDANCE = readFileSync(new URL("./guidance.md", import.meta.url), "utf8").trim();
const CARD_ENTRY = "mind-card";
/** PiSpark marks a run that something other than the person started with this entry before its message. */
const WOKEN_ENTRY = "pispark:woken";
const LESSON_ENTRY = "mind-lesson";
/** PiSpark's bus channel for starting this session's own child sessions. */
const SESSION_REQUEST = "pispark:session-request";
const SWEEP =
  "Sweep this place's mind, using the reflect skill's sweep section: review ideas that have aged, proposals that waited long or no longer apply, " +
  "closed cards nobody reflected on, and anything over budget (/mind audit shows the audit). Tidy what you may; bring the person only what needs them, in a few lines.";
/** Words that usually carry a correction or a standing preference. */
const LESSON = /\b(always|never|from now on|next time|every|each time|in future|going forward|again|instead|don'?t|do not|stop|should(n'?t)?|make sure|remember|too (long|short|much|many|big|small)|keep (it|them|the|to)|i told you)\b/i;
const LESSON_REMINDER =
  "Before you finish: did the person's last message carry a lesson that should outlast this task, such as a correction or a standing preference? " +
  "If they stated it as a rule (always, never, from now on), record it now with mind_record, origin 'told', quoting their words. " +
  "If you changed course because they corrected you, offer the general lesson once with mind_record, origin 'ask'. " +
  "If there is nothing lasting, end your turn without saying anything more.";
const SECTION_LABEL: Record<string, string> = { purpose: "Purpose", "for-whom": "For whom", good: "What good looks like", "off-limits": "Off-limits" };

const text = (value: string, details?: unknown) => ({ content: [{ type: "text" as const, text: value }], details });
const normal = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

export default function mind(pi: ExtensionAPI) {
  let place: Mind | undefined;
  /** This session's own card (a goal that lives and dies with the session), restored from the branch. */
  let sessionCard: Card | undefined;
  /** What the person typed to start this run; undefined when a wake or an extension started it. */
  let personSaid: string | undefined;
  let compacted = false;
  /**
   * Starts a reflection on a closed card: a child session with fresh context, in the same place,
   * that proposes what outlasts the goal and retires the card. Returns a line for the tool result.
   */
  async function reflect(card: Card, ctx: ExtensionContext, retire: boolean): Promise<string> {
    const transcript = transcriptOf(card.source, ctx);
    const prompt = [
      `Reflect on this closed goal, using the reflect skill.`,
      `Card: ${cardText(card)}`,
      transcript ? `It was worked on in the session whose transcript is ${transcript} (JSON lines; read what you need).` : "",
      retire ? `When you're done, retire the card: mind_work action "retire", id "${card.id}".` : "",
    ].filter(Boolean).join("\n");
    const answer = await new Promise<{ ok: boolean; text: string } | undefined>((resolve) => {
      const message = { request: { action: "start", prompt, title: `Reflect · ${card.goal.slice(0, 60)}`, report: "none" }, reply: resolve, taken: false };
      pi.events.emit(SESSION_REQUEST, message);
      if (!message.taken) resolve(undefined);
    });
    if (!answer) return "";
    return answer.ok ? " · Reflection started in the background." : ` · Reflection could not start: ${answer.text}`;
  }

  /** Yes/no questions already asked in this session. */
  const asked = new Set<string>();
  /** Whether this run recorded something, and whether it was already reminded to. */
  let recorded = false;
  let nudged = false;

  const mindOf = (ctx: ExtensionContext) => (place && place.place === ctx.cwd ? place : (place = new Mind(ctx.cwd)));
  const sessionId = (ctx: ExtensionContext) => ctx.sessionManager.getSessionId();

  pi.on("session_start", async (_event, ctx) => {
    place = new Mind(ctx.cwd);
    sessionCard = undefined;
    for (const entry of ctx.sessionManager.getBranch())
      if (entry.type === "custom" && entry.customType === CARD_ENTRY) sessionCard = (entry.data as Card | null) ?? undefined;
    await show(ctx);
  });

  /**
   * The Mind view: what the agent believes here and what waits on the person. Offered beside the
   * conversation (PiSpark's `session.view`); its actions are the person's, so they apply directly.
   */
  let viewing: ExtensionContext | undefined;
  async function show(ctx: ExtensionContext, attention = false) {
    viewing = ctx;
    const m = mindOf(ctx);
    let snapshot;
    try {
      snapshot = await snapshotOf(m);
    } catch {
      return;
    }
    const person = async (change: () => Promise<unknown>) => {
      await change();
      if (viewing) await show(viewing);
    };
    pi.events.emit("pispark:view", {
      point: "session.view",
      key: "mind",
      title: "Mind",
      component: new URL("./Mind.svelte", import.meta.url),
      props: { snapshot },
      ...(attention ? { attention: true } : {}),
      calls: {
        accept: ({ id }: { id: string }) => person(() => m.accept(id, sessionId(ctx))),
        reject: ({ id }: { id: string }) => person(() => m.dismiss(id)),
        forget: ({ id }: { id: string }) => person(() => m.remove(id)),
      },
    });
  }
  // Keep the view current as the agent works, and when another session (a reflection) changed it.
  pi.on("tool_execution_end", async (event, ctx) => {
    if (String(event.toolName).startsWith("mind_")) await show(ctx);
  });
  pi.on("agent_settled", async (_event, ctx) => {
    await show(ctx);
  });

  // The place's own skills, loaded by Pi (and again on reload).
  pi.on("resources_discover", (event) => {
    const skills = join(event.cwd, FOLDER, "skills");
    return { skillPaths: [skills] };
  });

  pi.on("session_compact", () => {
    compacted = true;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    // Our own reminder continues the person's run: what they said still counts.
    const reminder = event.messageType === "custom" && event.message.customType === LESSON_ENTRY;
    if (!reminder) {
      personSaid = event.messageType === "user" && startedByPerson(event.messageType, ctx.sessionManager.getBranch()) ? event.prompt : undefined;
      recorded = false;
      nudged = false;
    }
    event.systemPromptOptions.sections.mind = await slice(mindOf(ctx), sessionCard, compacted);
    compacted = false;
  });

  // The parts change only through the tools: no raw writes into the folder.
  pi.on("tool_call", (event, ctx) => {
    const dir = join(ctx.cwd, FOLDER);
    const inside = (path: unknown) => {
      if (typeof path !== "string") return false;
      const target = resolve(ctx.cwd, path.replace(/^@/, ""));
      const rel = relative(dir, target);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    };
    const input = event.input as Record<string, unknown>;
    if ((event.toolName === "write" || event.toolName === "edit") && inside(input.path))
      return { block: true, reason: `${FOLDER}/ is written only through the mind tools (mind_work, mind_record).` };
    if ((event.toolName === "bash" || event.toolName === "powershell") && typeof input.command === "string") {
      const command = input.command;
      if (command.includes(FOLDER) && /(>|\brm\b|\bmv\b|\bcp\b|\bsed\s+-i|\btee\b|Set-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item)/i.test(command))
        return { block: true, reason: `${FOLDER}/ is written only through the mind tools (mind_work, mind_record).` };
    }
    return undefined;
  });

  // A correction or a standing preference is easy to fix and forget: before the run ends, remind
  // the agent once to keep the lesson. Only for runs the person started, when their words read like one.
  pi.on("agent_before_settle", (event) => {
    if (nudged || recorded || !personSaid || !LESSON.test(personSaid)) return undefined;
    nudged = true;
    return {
      entries: [...event.entries, { type: "custom_message" as const, customType: LESSON_ENTRY, content: LESSON_REMINDER, display: false }],
      continue: true,
    };
  });

  pi.registerTool({
    name: "mind_work",
    label: "Work card",
    description:
      "Keep goals on cards, from idea to done. add: an idea nobody has agreed to yet (not shown each run). commit: the person wants it done, not started yet. start: working on it now (without an id it creates the card; scope 'session' for a goal that lives only in this session). update: state, next step, what it waits on, done-when, authority given for this goal. wait/done/drop: move it (closing a card starts a reflection in the background). promote: this session's card becomes a card of the place. retire: remove a closed card once reflected on.",
    promptSnippet: "Keep goals on work cards that survive compaction and new sessions.",
    parameters: Type.Object({
      action: Type.Union(["add", "commit", "start", "update", "wait", "done", "drop", "promote", "retire"].map((a) => Type.Literal(a))),
      id: Type.Optional(Type.String({ maxLength: 20, description: "The card, or 'session' for this session's card." })),
      scope: Type.Optional(Type.Union([Type.Literal("place"), Type.Literal("session")], { description: "For a new card: the place (default) or only this session." })),
      goal: Type.Optional(Type.String({ maxLength: 200 })),
      doneWhen: Type.Optional(Type.String({ maxLength: 300 })),
      state: Type.Optional(Type.String({ maxLength: 400 })),
      next: Type.Optional(Type.String({ maxLength: 200 })),
      waitingOn: Type.Optional(Type.String({ maxLength: 200 })),
      authority: Type.Optional(Type.String({ maxLength: 200, description: "Authority the person gave for this goal only." })),
    }, { additionalProperties: false }),
    async execute(_id, params, _signal, _update, ctx) {
      const source = sessionId(ctx);
      const fields: Partial<Card> = {};
      for (const key of ["doneWhen", "state", "next", "waitingOn", "authority"] as const)
        if (params[key] !== undefined) fields[key] = params[key]!.trim() || undefined;
      const stageOf: Record<string, Card["stage"]> = { commit: "committed", start: "active", wait: "waiting", done: "done", drop: "dropped" };

      // This session's card lives in the session.
      if (params.id === "session" || (sessionCard && params.id === sessionCard.id) || (params.action === "start" && !params.id && params.scope === "session")) {
        if (params.action === "promote") {
          if (!sessionCard) throw new Error("This session has no card.");
          const promoted = await mindOf(ctx).card((cards) => {
            const card = { ...sessionCard!, ...fields };
            cards.push(card);
            return card;
          });
          sessionCard = undefined;
          pi.appendEntry(CARD_ENTRY, null);
          return text(`Promoted: ${cardText(promoted)}`, { card: promoted });
        }
        if (params.action === "start" && !sessionCard) {
          sessionCard = newCard(params.goal ?? "", source, { stage: "active", ...fields });
        } else {
          if (!sessionCard) throw new Error("This session has no card yet: start one.");
          sessionCard = { ...sessionCard, ...fields, ...(params.goal ? { goal: field(params.goal, 200, "The goal") } : {}), ...(stageOf[params.action] ? { stage: stageOf[params.action] } : {}), updated: new Date().toISOString() };
        }
        const closed = CLOSED.includes(sessionCard.stage);
        const shown = sessionCard;
        pi.appendEntry(CARD_ENTRY, closed ? null : sessionCard);
        if (closed) sessionCard = undefined;
        const reflecting = closed ? await reflect(shown, ctx, false) : "";
        return text(`${closed ? "Closed" : "Session card"}: ${cardText(shown)}${reflecting}`, { card: shown });
      }

      if (params.action === "retire") {
        if (!params.id) throw new Error("Name the card (id).");
        const retired = await mindOf(ctx).update("work", (w) => {
          const card = w.cards.find((c) => c.id === params.id);
          if (!card) throw new Error(`No card ${params.id}.`);
          if (!CLOSED.includes(card.stage)) throw new Error("Only a closed card (done or dropped) is retired.");
          w.cards = w.cards.filter((c) => c !== card);
          return card;
        });
        return text(`Retired: ${retired.goal}`);
      }
      const before = params.id ? (await mindOf(ctx).read("work")).cards.find((c) => c.id === params.id)?.stage : undefined;
      const card = await mindOf(ctx).card((cards) => {
        if (!params.id) {
          if (params.action !== "add" && params.action !== "start" && params.action !== "commit") throw new Error("Name the card (id).");
          const created = newCard(params.goal ?? "", source, { ...fields, stage: params.action === "add" ? "idea" : stageOf[params.action]! });
          cards.push(created);
          return created;
        }
        const existing = cards.find((c) => c.id === params.id);
        if (!existing) throw new Error(`No card ${params.id}.`);
        if (params.action === "promote") throw new Error("Only this session's card can be promoted.");
        Object.assign(existing, fields);
        if (params.goal) existing.goal = field(params.goal, 200, "The goal");
        const stage = stageOf[params.action];
        if (stage) existing.stage = stage;
        return existing;
      });
      const closedNow = CLOSED.includes(card.stage) && !CLOSED.includes(before ?? "idea");
      // An idea dropped before anyone took it on has nothing to teach.
      const reflecting = closedNow && !(card.stage === "dropped" && before === "idea") ? await reflect(card, ctx, true) : "";
      return text(`${closedNow ? "Closed" : "Card"}: ${cardText(card)}${reflecting}`, { card });
    },
  });

  pi.registerTool({
    name: "mind_record",
    label: "Remember",
    description:
      "Change the charter, contract or knowledge. origin 'told': the person said it in this conversation; quote their words and it is recorded. origin 'ask': ask the person now, yes or no (after they corrected or repeated something: 'keep this as a standing rule?'; after approving something routine: a contract rule with act 'own', 'next time, handle this yourself?'); a yes records it. origin 'inferred': it becomes a proposal the person accepts or rejects later. op 'remove' or 'change' name the item (target). Also accept or reject a proposal when the person says so (op 'accept'/'reject', target = proposal id, origin 'told', quote).",
    promptSnippet: "Remember what the person tells you; propose what you infer.",
    parameters: Type.Object({
      op: Type.Union(["add", "change", "remove", "accept", "reject", "withdraw"].map((a) => Type.Literal(a))),
      origin: Type.Union([Type.Literal("told"), Type.Literal("ask"), Type.Literal("inferred")]),
      part: Type.Optional(Type.Union([Type.Literal("charter"), Type.Literal("contract"), Type.Literal("knowledge"), Type.Literal("skill")])),
      name: Type.Optional(Type.String({ maxLength: 40, description: "Skill: its name, lowercase-with-hyphens." })),
      description: Type.Optional(Type.String({ maxLength: 300, description: "Skill: when to use it." })),
      body: Type.Optional(Type.String({ maxLength: 6000, description: "Skill: the procedure, as Markdown steps." })),
      target: Type.Optional(Type.String({ maxLength: 20, description: "The item (or proposal) this is about." })),
      section: Type.Optional(Type.Union(CHARTER_SECTIONS.map((s) => Type.Literal(s)), { description: "Charter section." })),
      text: Type.Optional(Type.String({ maxLength: 300, description: "Charter text." })),
      when: Type.Optional(Type.String({ maxLength: 200, description: "Contract: the situation." })),
      act: Type.Optional(Type.Union(ACTS.map((a) => Type.Literal(a)), { description: "Contract: own, tell, ask or never." })),
      what: Type.Optional(Type.String({ maxLength: 200, description: "Contract: the action as a noun phrase, e.g. \"running the README examples\"." })),
      claim: Type.Optional(Type.String({ maxLength: 240, description: "Knowledge: the claim, one line." })),
      why: Type.Optional(Type.String({ maxLength: 400, description: "Knowledge: why it matters beyond any one goal." })),
      quote: Type.Optional(Type.String({ maxLength: 400, description: "For told: the person's own words." })),
      reason: Type.Optional(Type.String({ maxLength: 300, description: "For inferred: why, and where it came from." })),
    }, { additionalProperties: false }),
    async execute(_id, p, _signal, _update, ctx) {
      recorded = true;
      const m = mindOf(ctx);
      const source = sessionId(ctx);
      const told = p.origin === "told" && quotes(personSaid, p.quote);
      if (p.op === "withdraw") {
        if (!p.target) throw new Error("Name the proposal (target).");
        return text((await m.dismiss(p.target)) ? `Withdrew ${p.target}.` : `No proposal ${p.target}.`);
      }
      if (p.op === "accept" || p.op === "reject") {
        if (!p.target) throw new Error("Name the proposal (target).");
        if (!told) throw new Error("Only the person accepts or rejects proposals: quote their words from this conversation, or they use /mind.");
        if (p.op === "reject") return text((await m.dismiss(p.target)) ? `Rejected ${p.target}.` : `No proposal ${p.target}.`);
        return text(await m.accept(p.target, source));
      }
      let item: Item | undefined;
      if (p.op !== "remove") {
        if (p.part === "charter") item = { part: "charter", section: p.section!, text: p.text ?? "" };
        else if (p.part === "contract") item = { part: "contract", when: p.when ?? "", act: p.act!, what: p.what ?? "" };
        else if (p.part === "knowledge") item = { part: "knowledge", claim: p.claim ?? "", why: p.why ?? "" };
        else if (p.part === "skill") item = { part: "skill", name: p.name ?? "", description: p.description ?? "", body: p.body ?? "" };
        else throw new Error("Say which part: charter, contract or knowledge.");
      } else if (!p.target) throw new Error("Name the item to remove (target).");
      if (p.op === "change" && !p.target) throw new Error("Name the item to change (target).");
      let quote = p.quote;
      if (p.origin === "ask") {
        const question = askFor(p.op, item, p.target);
        // Once per situation in a session: a no is not asked again.
        if (asked.has(normal(question.text))) return text("Already asked in this session; not asking again.");
        if (!ctx.hasUI) return text("No one to ask now. Not recorded.");
        asked.add(normal(question.text));
        const yes = await ctx.ui.confirm(question.title, question.text);
        if (!yes) return text("The person said no. Not recorded.");
        quote = `yes to: ${question.title} ${question.text}`;
      }
      if (told || p.origin === "ask") {
        if (p.op === "remove") return text((await m.remove(p.target!)) ? `Removed ${p.target}.` : `No item ${p.target}.`);
        const id = await m.apply(item!, { origin: "told", source, quote, at: new Date().toISOString() }, p.op === "change" ? p.target : undefined);
        return text(`Recorded ${id}: ${itemText(item!)}`);
      }
      const reason = (p.reason ?? "").trim() || (p.origin === "told" ? "Said by the person, but not quoted from what they typed to start this run." : "");
      if (!reason) throw new Error("Give a short reason for the proposal in the reason field: why, and where it came from.");
      const id = await m.propose({ op: p.op as "add" | "change" | "remove", target: p.target, item, reason, source });
      return text(`Proposed ${id} for the person to accept or reject (/mind). ${item ? itemText(item) : `Remove ${p.target}`}`);
    },
  });

  pi.registerTool({
    name: "mind_decide",
    label: "Ask for a decision",
    description:
      "Ask the person for a decision you can't make under your contract. One short question, your recommendation, at most three options, and what happens if they don't answer (the safe default). Returns their choice. Don't use it for things the contract says you own.",
    promptSnippet: "Ask the person for a decision: one question, a recommendation, few options.",
    parameters: Type.Object({
      question: Type.String({ minLength: 3, maxLength: 200 }),
      recommended: Type.String({ minLength: 1, maxLength: 80, description: "The option you recommend; listed first." }),
      others: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 2, description: "At most two other options." }),
      ifNoAnswer: Type.String({ minLength: 3, maxLength: 160, description: "What you'll do if they don't answer: nothing risky." }),
    }, { additionalProperties: false }),
    async execute(_id, p, signal, _update, ctx) {
      if (!ctx.hasUI) return text(`No one to ask now. ${p.ifNoAnswer}`);
      const recommended = `${p.recommended} (recommended)`;
      const choice = await ctx.ui.select(`${p.question}\nIf no answer: ${p.ifNoAnswer}`, [recommended, ...p.others], { signal });
      if (choice === undefined) return text(`No answer. ${p.ifNoAnswer}`, { answered: false });
      const chosen = choice === recommended ? p.recommended : choice;
      return text(`The person chose: ${chosen}`, { answered: true, chosen });
    },
  });

  pi.registerCommand("mind", {
    description: "This place's mind: what's waiting on you. /mind accept <id>, /mind reject <id>, /mind audit",
    handler: async (args, ctx) => {
      const m = mindOf(ctx);
      const [verb, id] = args.trim().split(/\s+/);
      try {
        if (verb === "accept" && id) return ctx.ui.notify(await m.accept(id, sessionId(ctx)), "info");
        if (verb === "reject" && id) return ctx.ui.notify((await m.dismiss(id)) ? `Rejected ${id}.` : `No proposal ${id}.`, "info");
        if (verb === "reflect") {
          const closed = (await m.read("work")).cards.filter((c) => CLOSED.includes(c.stage));
          if (!closed.length) return ctx.ui.notify("No closed cards wait for reflection.", "info");
          const notes = await Promise.all(closed.map((card) => reflect(card, ctx, true)));
          return ctx.ui.notify(notes.map((n) => n.trim()).join("\n"), "info");
        }
        if (verb === "sweep") return pi.sendUserMessage(SWEEP);
        if (verb === "audit") {
          const findings = await audit(m);
          return ctx.ui.notify(findings.length ? findings.map((f) => `• ${f.text}`).join("\n") : "The mind is in shape.", findings.length ? "warning" : "info");
        }
        await show(ctx, true);
        const parts = await m.readAll();
        const waiting = parts.proposals.proposals.map((p) => `• ${p.id}: ${p.item ? itemText(p.item) : `remove ${p.target}`} (${p.reason})`);
        ctx.ui.notify(
          [
            `Charter ${parts.charter.items.length} · contract ${parts.contract.rules.length} · knowledge ${parts.knowledge.notes.length} · active cards ${parts.work.cards.filter((c) => ACTIVE.includes(c.stage)).length}`,
            waiting.length ? `Waiting on you:\n${waiting.join("\n")}\nAccept or reject with /mind accept <id>, /mind reject <id>.` : "Nothing is waiting on you.",
          ].join("\n"),
          "info",
        );
      } catch (error) {
        ctx.ui.notify((error as Error).message, "error");
      }
    },
  });
}

/**
 * Whether the person started this run: a prompt, not an extension's message, and not a wake
 * (PiSpark puts a `pispark:woken` entry just before a wake's message).
 */
export function startedByPerson(messageType: string, branch: readonly { type: string; customType?: string }[]): boolean {
  return messageType === "user" && !branch.slice(-2).some((e) => e.type === "custom" && e.customType === WOKEN_ENTRY);
}

/** A told item must quote what the person typed to start this run. */
export function quotes(personSaid: string | undefined, quote: string | undefined): boolean {
  return personSaid !== undefined && !!quote?.trim() && normal(personSaid).includes(normal(quote));
}

/**
 * The transcript of the session a card was worked on in: PiSpark keeps each session's Pi transcript
 * in a folder named after it, beside this one's. Falls back to this session's.
 */
function transcriptOf(source: string, ctx: ExtensionContext): string | undefined {
  const own = ctx.sessionManager.getSessionFile();
  if (!own || !/^[\w-]+$/.test(source)) return own;
  const folder = join(dirname(dirname(own)), source);
  try {
    const file = readdirSync(folder).find((name) => name.endsWith(".jsonl"));
    return file ? join(folder, file) : own;
  } catch {
    return own;
  }
}

/** What the Mind view shows: plain data, small enough for a view's props. */
async function snapshotOf(m: Mind) {
  const parts = await m.readAll();
  const findings = await audit(m);
  return {
    charter: parts.charter.items,
    contract: parts.contract.rules.map((r) => ({ ...r, text: `${ruleText(r)}.` })),
    notes: parts.knowledge.notes,
    skills: parts.knowledge.skills,
    cards: parts.work.cards.map(({ id, goal, stage, doneWhen, state, next, waitingOn, authority }) => ({ id, goal, stage, doneWhen, state, next, waitingOn, authority })),
    proposals: parts.proposals.proposals.map((p) => ({ id: p.id, text: p.item ? itemText(p.item) : `Forget ${p.target}`, reason: p.reason, at: p.at })),
    findings: findings.map((f) => f.text),
  };
}

/** The one yes/no question for a record the agent asks about. */
function askFor(op: string, item: Item | undefined, target: string | undefined): { title: string; text: string } {
  if (op === "remove") return { title: "Forget this?", text: `Remove ${target}.` };
  if (!item) throw new Error("Say what to record.");
  const title = item.part === "contract"
    ? item.act === "own" ? "Next time, handle this yourself?" : "Keep this as a standing rule?"
    : item.part === "charter" ? "Add this to what we're here for?" : "Remember this?";
  return { title, text: itemText(shaped(item)) };
}

/** The pinned slice: guidance, charter, contract, active cards and the knowledge index. */
export async function slice(m: Mind, sessionCard: Card | undefined, compacted: boolean): Promise<string> {
  const parts = await m.readAll();
  const findings = await audit(m);
  const out = [GUIDANCE, ""];
  out.push("## Charter");
  if (parts.charter.items.length)
    for (const section of CHARTER_SECTIONS) {
      const items = parts.charter.items.filter((i) => i.section === section);
      if (items.length) out.push(`${SECTION_LABEL[section]}: ${items.map((i) => i.text).join(" ")}`);
    }
  else out.push("(empty: finding out what you're here for is your first goal)");
  out.push("", "## Contract");
  out.push(...(parts.contract.rules.length ? parts.contract.rules.map((r) => `- ${ruleText(r)}.`) : ["(empty: ask before anything consequential)"]));
  out.push("", "## Work");
  if (sessionCard) out.push(`This session: ${cardText(sessionCard)}`);
  const active = parts.work.cards.filter((c) => ACTIVE.includes(c.stage));
  out.push(...active.map((c) => `- ${cardText(c)}`));
  const ideas = parts.work.cards.filter((c) => c.stage === "idea").length;
  const closed = parts.work.cards.filter((c) => CLOSED.includes(c.stage)).length;
  if (closed) out.push(`${closed} closed card${closed === 1 ? " waits" : "s wait"} for reflection (/mind reflect).`);
  if (!sessionCard && !active.length) out.push("(no active cards)");
  if (ideas) out.push(`${ideas} idea${ideas === 1 ? "" : "s"} in ${FOLDER}/work.json.`);
  out.push("", "## Knowledge");
  out.push(...(parts.knowledge.notes.length ? parts.knowledge.notes.map((n) => `- [${n.id}] ${n.claim}`) : ["(empty)"]));
  if (parts.knowledge.notes.length) out.push(`Why each matters, and where it came from: ${FOLDER}/knowledge.json.`);
  const waiting = parts.proposals.proposals.length;
  if (waiting) out.push("", `${waiting} proposal${waiting === 1 ? " is" : "s are"} waiting for the person (/mind).`);
  if (findings.length) out.push("", `Audit: ${findings.map((f) => f.text).join(" ")}`);
  if (compacted) out.push("", "The conversation was just compacted: re-read the active card and check your next step against it before going on.");
  return out.join("\n");
}

