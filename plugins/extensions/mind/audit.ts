import { readdir } from "node:fs/promises";
import { ACTIVE, BUDGET, CLOSED, FILES, indexTokens, type Mind, ruleText, tokens } from "./store.js";

/**
 * Plain checks, no model: the structure holds (nothing stray), parts stay within budget, and the
 * usual ways memory rots are flagged early (goal detail in knowledge, stale cards and proposals).
 */
export interface Finding { kind: "budget" | "stray" | "goal-detail" | "stale" | "unreadable"; text: string }

const DAY = 86_400_000;
const age = (iso: string) => (Date.now() - Date.parse(iso)) / DAY;
/** Signs a note is about one goal rather than lasting: commit hashes, branch names, dates, card ids. */
const GOAL_DETAIL = /\b[0-9a-f]{7,40}\b|\b(feat|fix|chore)\/[\w.-]+|\b20\d\d-\d\d-\d\d\b|\bPR ?#?\d+|\bcommit(ted)?\b/i;

export async function audit(mind: Mind): Promise<Finding[]> {
  if (!mind.exists()) return [];
  const findings: Finding[] = [];
  const allowed = new Set<string>([...FILES, "skills", ".gitignore"]);
  for (const entry of await readdir(mind.dir))
    if (!allowed.has(entry) && !entry.endsWith(".tmp")) findings.push({ kind: "stray", text: `${entry} is not part of the mind's structure.` });
  let parts;
  try {
    parts = await mind.readAll();
  } catch (error) {
    return [...findings, { kind: "unreadable", text: (error as Error).message }];
  }
  const budget = (what: string, used: number, max: number) => {
    if (used > max) findings.push({ kind: "budget", text: `The ${what} is about ${used} tokens, over its ${max}.` });
  };
  budget("charter", tokens(parts.charter.items.map((i) => i.text).join("\n")), BUDGET.charter);
  budget("contract", tokens(parts.contract.rules.map(ruleText).join("\n")), BUDGET.contract);
  budget("knowledge index", indexTokens(parts.knowledge), BUDGET.knowledge);
  for (const note of parts.knowledge.notes)
    if (GOAL_DETAIL.test(`${note.claim} ${note.why}`))
      findings.push({ kind: "goal-detail", text: `Note ${note.id} looks tied to one goal ("${note.claim.slice(0, 60)}"): keep it in the code or its history, not in knowledge.` });
  for (const card of parts.work.cards) {
    if (ACTIVE.includes(card.stage) && age(card.updated) > 14) findings.push({ kind: "stale", text: `Card ${card.id} (${card.stage}) hasn't moved in ${Math.floor(age(card.updated))} days.` });
    if (CLOSED.includes(card.stage) && age(card.updated) > 7) findings.push({ kind: "stale", text: `Card ${card.id} closed ${Math.floor(age(card.updated))} days ago and still waits for reflection.` });
    if (card.stage === "idea" && age(card.updated) > 60) findings.push({ kind: "stale", text: `Idea ${card.id} is ${Math.floor(age(card.updated))} days old: commit to it or drop it.` });
  }
  for (const p of parts.proposals.proposals)
    if (age(p.at) > 30) findings.push({ kind: "stale", text: `Proposal ${p.id} has waited ${Math.floor(age(p.at))} days.` });
  return findings;
}
