import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { audit } from "./audit.js";
import {
  ACTIVE, ACTS, CHARTER_SECTIONS, type Card, cardText, FOLDER, type Item, itemText, Mind, newCard, ruleText, field,
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

  const mindOf = (ctx: ExtensionContext) => (place && place.place === ctx.cwd ? place : (place = new Mind(ctx.cwd)));
  const sessionId = (ctx: ExtensionContext) => ctx.sessionManager.getSessionId();

  pi.on("session_start", async (_event, ctx) => {
    place = new Mind(ctx.cwd);
    sessionCard = undefined;
    for (const entry of ctx.sessionManager.getBranch())
      if (entry.type === "custom" && entry.customType === CARD_ENTRY) sessionCard = (entry.data as Card | null) ?? undefined;
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
    personSaid = event.messageType === "user" && startedByPerson(event.messageType, ctx.sessionManager.getBranch()) ? event.prompt : undefined;
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

  pi.registerTool({
    name: "mind_work",
    label: "Work card",
    description:
      "Keep goals on cards, from idea to done. add: an idea nobody has agreed to yet (not shown each run). commit: the person wants it done, not started yet. start: working on it now (without an id it creates the card; scope 'session' for a goal that lives only in this session). update: state, next step, what it waits on, done-when, authority given for this goal. wait/done/drop: move it. promote: this session's card becomes a card of the place.",
    promptSnippet: "Keep goals on work cards that survive compaction and new sessions.",
    parameters: Type.Object({
      action: Type.Union(["add", "commit", "start", "update", "wait", "done", "drop", "promote"].map((a) => Type.Literal(a))),
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
      if (params.id === "session" || (params.action === "start" && !params.id && params.scope === "session")) {
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
        const closed = sessionCard.stage === "done" || sessionCard.stage === "dropped";
        const shown = sessionCard;
        pi.appendEntry(CARD_ENTRY, closed ? null : sessionCard);
        if (closed) sessionCard = undefined;
        return text(`${closed ? "Closed" : "Session card"}: ${cardText(shown)}`, { card: shown });
      }

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
      return text(`${card.stage === "done" || card.stage === "dropped" ? "Closed" : "Card"}: ${cardText(card)}`, { card });
    },
  });

  pi.registerTool({
    name: "mind_record",
    label: "Remember",
    description:
      "Change the charter, contract or knowledge. origin 'told': the person said it in this conversation; quote their words and it is recorded. origin 'inferred': it becomes a proposal the person accepts or rejects. op 'remove' or 'change' name the item (target). Also accept or reject a proposal when the person says so (op 'accept'/'reject', target = proposal id, origin 'told', quote).",
    promptSnippet: "Remember what the person tells you; propose what you infer.",
    parameters: Type.Object({
      op: Type.Union(["add", "change", "remove", "accept", "reject"].map((a) => Type.Literal(a))),
      origin: Type.Union([Type.Literal("told"), Type.Literal("inferred")]),
      part: Type.Optional(Type.Union([Type.Literal("charter"), Type.Literal("contract"), Type.Literal("knowledge")])),
      target: Type.Optional(Type.String({ maxLength: 20, description: "The item (or proposal) this is about." })),
      section: Type.Optional(Type.Union(CHARTER_SECTIONS.map((s) => Type.Literal(s)), { description: "Charter section." })),
      text: Type.Optional(Type.String({ maxLength: 300, description: "Charter text." })),
      when: Type.Optional(Type.String({ maxLength: 200, description: "Contract: the situation." })),
      act: Type.Optional(Type.Union(ACTS.map((a) => Type.Literal(a)), { description: "Contract: own, tell, ask or never." })),
      what: Type.Optional(Type.String({ maxLength: 200, description: "Contract: the action." })),
      claim: Type.Optional(Type.String({ maxLength: 240, description: "Knowledge: the claim, one line." })),
      why: Type.Optional(Type.String({ maxLength: 400, description: "Knowledge: why it matters beyond any one goal." })),
      quote: Type.Optional(Type.String({ maxLength: 400, description: "For told: the person's own words." })),
      reason: Type.Optional(Type.String({ maxLength: 300, description: "For inferred: why, and where it came from." })),
    }, { additionalProperties: false }),
    async execute(_id, p, _signal, _update, ctx) {
      const m = mindOf(ctx);
      const source = sessionId(ctx);
      const told = p.origin === "told" && quotes(personSaid, p.quote);
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
        else throw new Error("Say which part: charter, contract or knowledge.");
      } else if (!p.target) throw new Error("Name the item to remove (target).");
      if (p.op === "change" && !p.target) throw new Error("Name the item to change (target).");
      if (told) {
        if (p.op === "remove") return text((await m.remove(p.target!)) ? `Removed ${p.target}.` : `No item ${p.target}.`);
        const id = await m.apply(item!, { origin: "told", source, quote: p.quote, at: new Date().toISOString() }, p.op === "change" ? p.target : undefined);
        return text(`Recorded ${id}: ${itemText(item!)}`);
      }
      const reason = (p.reason ?? "").trim() || (p.origin === "told" ? "Said by the person, but not quoted from what they typed to start this run." : "");
      if (!reason) throw new Error("Give a short reason for the proposal.");
      const id = await m.propose({ op: p.op as "add" | "change" | "remove", target: p.target, item, reason, source });
      return text(`Proposed ${id} for the person to accept or reject (/mind). ${item ? itemText(item) : `Remove ${p.target}`}`);
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
        if (verb === "audit") {
          const findings = await audit(m);
          return ctx.ui.notify(findings.length ? findings.map((f) => `• ${f.text}`).join("\n") : "The mind is in shape.", findings.length ? "warning" : "info");
        }
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

