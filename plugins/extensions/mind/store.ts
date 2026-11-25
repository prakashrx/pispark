import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

/**
 * A place's mind: four parts kept in `<place>/.mind/` as plain JSON the person can read, plus
 * proposals waiting for the person and the place's own skills. Every write goes through here, so
 * the shapes, budgets and provenance hold whoever writes.
 */

export const FOLDER = ".mind";
export const FILES = ["charter.json", "contract.json", "knowledge.json", "work.json", "proposals.json"] as const;
/** Default budgets, in estimated tokens (decision 13). */
export const BUDGET = { charter: 500, contract: 800, knowledge: 1000, cards: 1000, note: 300 } as const;
/** About four characters per token: enough to keep parts small, not a tokenizer. */
export const tokens = (text: string) => Math.ceil(text.length / 4);

export type Origin = "told" | "inferred";
export interface Provenance {
  origin: Origin;
  /** The session it came from. */
  source: string;
  /** For told items: the person's own words. */
  quote?: string;
  at: string;
}
export const CHARTER_SECTIONS = ["purpose", "for-whom", "good", "off-limits"] as const;
export type CharterSection = (typeof CHARTER_SECTIONS)[number];
export interface CharterItem extends Provenance { id: string; section: CharterSection; text: string }
export const ACTS = ["own", "tell", "ask", "never"] as const;
export type Act = (typeof ACTS)[number];
export interface Rule extends Provenance { id: string; when: string; act: Act; what: string }
export interface Note extends Provenance { id: string; claim: string; why: string }
export const STAGES = ["idea", "committed", "active", "waiting", "done", "dropped"] as const;
export type Stage = (typeof STAGES)[number];
export interface Card {
  id: string;
  goal: string;
  doneWhen?: string;
  stage: Stage;
  state?: string;
  next?: string;
  waitingOn?: string;
  /** Authority given for this goal only ("merge and release if good"); it ends with the goal. */
  authority?: string;
  source: string;
  created: string;
  updated: string;
}
export type Part = "charter" | "contract" | "knowledge";
export type Item =
  | { part: "charter"; section: CharterSection; text: string }
  | { part: "contract"; when: string; act: Act; what: string }
  | { part: "knowledge"; claim: string; why: string };
export interface Proposal {
  id: string;
  op: "add" | "change" | "remove";
  /** The item a change or removal is about. */
  target?: string;
  item?: Item;
  reason: string;
  source: string;
  at: string;
}

interface Parts {
  charter: { items: CharterItem[] };
  contract: { rules: Rule[] };
  knowledge: { notes: Note[] };
  work: { cards: Card[] };
  proposals: { proposals: Proposal[] };
}
const EMPTY: Parts = {
  charter: { items: [] },
  contract: { rules: [] },
  knowledge: { notes: [] },
  work: { cards: [] },
  proposals: { proposals: [] },
};
type Name = keyof Parts;

export const ACTIVE: Stage[] = ["committed", "active", "waiting"];
const shortId = () => randomUUID().slice(0, 6);
const now = () => new Date().toISOString();
const line = (value: unknown, max: number, what: string): string => {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) throw new Error(`${what} is required.`);
  if (text.length > max) throw new Error(`${what} is too long (at most ${max} characters): say it shorter.`);
  return text;
};

/** Mid-sentence: a lowercase first letter (unless it starts an acronym or a name), no closing period. */
const clause = (s: string) => s.replace(/[.\s]+$/, "").replace(/^[A-Z](?=[a-z\s])/, (c) => c.toLowerCase());
export const ruleText = (r: { when: string; act: Act; what: string }) => `When ${clause(r.when)}, I ${r.act} ${clause(r.what)}`;
export const itemText = (item: Item) =>
  item.part === "charter" ? `${item.section}: ${item.text}`
  : item.part === "contract" ? ruleText(item)
  : `${item.claim} (why: ${item.why})`;

/** Checks an item's shape; returns it tidied. Shapes are what keep the parts apart. */
export function shaped(item: Item): Item {
  if (item.part === "charter") {
    if (!CHARTER_SECTIONS.includes(item.section)) throw new Error(`A charter item belongs to one of: ${CHARTER_SECTIONS.join(", ")}.`);
    return { part: "charter", section: item.section, text: line(item.text, 300, "The charter text") };
  }
  if (item.part === "contract") {
    if (!ACTS.includes(item.act)) throw new Error(`A contract rule is "When <situation>, I <own|tell|ask|never> <action>".`);
    return { part: "contract", when: line(item.when, 200, "The situation"), act: item.act, what: line(item.what, 200, "The action") };
  }
  if (item.part === "knowledge") {
    const note = { part: "knowledge" as const, claim: line(item.claim, 240, "The claim"), why: line(item.why, 400, "Why it matters beyond this goal") };
    if (tokens(note.claim + note.why) > BUDGET.note) throw new Error(`A note is at most about ${BUDGET.note} tokens.`);
    return note;
  }
  throw new Error("Unknown part.");
}

export class Mind {
  readonly dir: string;
  constructor(readonly place: string) {
    this.dir = join(place, FOLDER);
  }

  exists() {
    return existsSync(this.dir);
  }

  async read<N extends Name>(name: N): Promise<Parts[N]> {
    try {
      const value = JSON.parse(await readFile(join(this.dir, `${name}.json`), "utf8"));
      return { ...structuredClone(EMPTY[name]), ...value };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY[name]);
      throw new Error(`${FOLDER}/${name}.json could not be read: ${(error as Error).message}`);
    }
  }

  async readAll(): Promise<Parts> {
    const [charter, contract, knowledge, work, proposals] = await Promise.all(
      (["charter", "contract", "knowledge", "work", "proposals"] as const).map((name) => this.read(name)),
    );
    return { charter, contract, knowledge, work, proposals } as Parts;
  }

  /** Read, change and write one part under Pi's per-file queue, so parallel writes don't lose each other. */
  async update<N extends Name, T>(name: N, change: (value: Parts[N]) => T): Promise<T> {
    const file = join(this.dir, `${name}.json`);
    return withFileMutationQueue(file, async () => {
      await this.ensure();
      const value = await this.read(name);
      const result = change(value);
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
      await rename(temporary, file);
      return result;
    });
  }

  /** The folder, kept out of version control by a `.gitignore` that ignores everything in it. */
  async ensure() {
    await mkdir(join(this.dir, "skills"), { recursive: true });
    const ignore = join(this.dir, ".gitignore");
    if (!existsSync(ignore)) await writeFile(ignore, "# The agent's memory of this place (PiSpark mind). Not part of the project.\n*\n", "utf8");
  }

  // ---- Charter, contract, knowledge --------------------------------------------------------

  /** Applies an item the person told or accepted, within budget. Returns its id. */
  async apply(item: Item, provenance: Provenance, target?: string): Promise<string> {
    const tidy = shaped(item);
    const id = target ?? shortId();
    if (tidy.part === "charter")
      await this.update("charter", (c) => {
        c.items = c.items.filter((i) => i.id !== id);
        c.items.push({ id, section: tidy.section, text: tidy.text, ...provenance });
        over("charter", tokens(c.items.map((i) => i.text).join("\n")), BUDGET.charter);
      });
    else if (tidy.part === "contract")
      await this.update("contract", (c) => {
        c.rules = c.rules.filter((r) => r.id !== id);
        c.rules.push({ id, when: tidy.when, act: tidy.act, what: tidy.what, ...provenance });
        over("contract", tokens(c.rules.map(ruleText).join("\n")), BUDGET.contract);
      });
    else
      await this.update("knowledge", (k) => {
        k.notes = k.notes.filter((n) => n.id !== id);
        k.notes.push({ id, claim: tidy.claim, why: tidy.why, ...provenance });
        over("knowledge index", tokens(k.notes.map((n) => n.claim).join("\n")), BUDGET.knowledge);
      });
    return id;
  }

  /** Removes an item from whichever part holds it. */
  async remove(id: string): Promise<boolean> {
    let found = false;
    await this.update("charter", (c) => { const n = c.items.length; c.items = c.items.filter((i) => i.id !== id); found ||= n !== c.items.length; });
    await this.update("contract", (c) => { const n = c.rules.length; c.rules = c.rules.filter((r) => r.id !== id); found ||= n !== c.rules.length; });
    await this.update("knowledge", (k) => { const n = k.notes.length; k.notes = k.notes.filter((x) => x.id !== id); found ||= n !== k.notes.length; });
    return found;
  }

  async propose(proposal: Omit<Proposal, "id" | "at">): Promise<string> {
    if (proposal.item) proposal.item = shaped(proposal.item);
    const id = shortId();
    await this.update("proposals", (p) => {
      p.proposals.push({ id, at: now(), ...proposal });
    });
    return id;
  }

  /** Accepts a proposal on the person's word: it becomes a told item. */
  async accept(id: string, source: string): Promise<string> {
    const proposal = (await this.read("proposals")).proposals.find((p) => p.id === id);
    if (!proposal) throw new Error(`No proposal ${id}.`);
    let result: string;
    if (proposal.op === "remove") {
      if (!proposal.target || !(await this.remove(proposal.target))) throw new Error(`Nothing to remove: ${proposal.target} is gone.`);
      result = `Removed ${proposal.target}.`;
    } else {
      if (!proposal.item) throw new Error(`Proposal ${id} has no item.`);
      const itemId = await this.apply(proposal.item, { origin: "told", source, quote: `accepted proposal ${id}`, at: now() }, proposal.op === "change" ? proposal.target : undefined);
      result = `Recorded ${itemId}: ${itemText(proposal.item)}`;
    }
    await this.dismiss(id);
    return result;
  }

  async dismiss(id: string): Promise<boolean> {
    return this.update("proposals", (p) => {
      const n = p.proposals.length;
      p.proposals = p.proposals.filter((x) => x.id !== id);
      return n !== p.proposals.length;
    });
  }

  // ---- Work ---------------------------------------------------------------------------------

  async card(change: (cards: Card[]) => Card): Promise<Card> {
    return this.update("work", (w) => {
      const card = change(w.cards);
      card.updated = now();
      over("active cards", tokens(w.cards.filter((c) => ACTIVE.includes(c.stage)).map(cardText).join("\n")), BUDGET.cards);
      return card;
    });
  }
}

export function newCard(goal: string, source: string, fields: Partial<Card> = {}): Card {
  const at = now();
  return { id: shortId(), goal: line(goal, 200, "The goal"), stage: "idea", source, created: at, updated: at, ...fields };
}

export function cardText(c: Card): string {
  return [
    `[${c.id}] ${c.goal}`,
    c.doneWhen && `done when: ${c.doneWhen}`,
    `stage: ${c.stage}`,
    c.state && `state: ${c.state}`,
    c.next && `next: ${c.next}`,
    c.waitingOn && `waiting on: ${c.waitingOn}`,
    c.authority && `authorised: ${c.authority}`,
  ].filter(Boolean).join(" · ");
}

function over(what: string, used: number, budget: number) {
  if (used > budget)
    throw new Error(`The ${what} would be about ${used} tokens, over its ${budget}-token budget. Merge, generalise or remove something first.`);
}

export const field = line;
