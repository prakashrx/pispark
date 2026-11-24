/**
 * The agent page's side of Agent Builder: the note each message carries, why sending waits, and
 * what the page does when a reply ends. Agent Builder itself is an ordinary Pi agent; this only
 * says what the page shows it and how the page follows its changes.
 */
import type { ResolvedItem } from "../../../../server/src/contract/agent-protocol";
import { isFresh, keyOf, KINDS, type AgentPage, type Kind, type Row } from "./agent-page.svelte";

/** Where an item's file is, seen from the agent's own folder (Agent Builder's working folder). */
function fileFrom(page: AgentPage, item: ResolvedItem): string | undefined {
  if (!item.path) return undefined;
  if (item.reference?.startsWith("bundled:")) return undefined;
  if (item.reference?.startsWith("shared:")) return `../../resources/${item.path}`;
  return item.origin.id === page.agent ? item.path : `../${item.origin.id}/${item.path}`;
}

/**
 * What Agent Builder is told with each message: which agent, the tab (its ID: "skills",
 * "settings"), what's open and where its file is, and the agent's items.
 */
export function builderNote(page: AgentPage, tab: string, open: Row | undefined): string {
  const view = page.view;
  if (!view) return "";
  const name = view.definition.name ?? page.agent;
  const kind = tab in KINDS ? (tab as Kind) : undefined;
  const lines = [`The person is on the agent page of "${name}" (id ${page.agent}), in the ${kind ? KINDS[kind].title : "Settings"} tab.`];
  if (open && isFresh(open)) {
    const where = open.name ? (open.type === "skills" ? `skills/${open.name}/SKILL.md` : `${open.type}/${open.name}.md`) : "";
    lines.push(`Open: a new ${KINDS[open.type].one}, not written yet${open.name ? `, named "${open.name}"` : ""}. Write it in this agent's folder${where ? ` as ${where}` : ""} and add it to agent.json's resources as local:<name>.`);
  } else if (open) {
    const where = fileFrom(page, open);
    const reach = page.reach(open);
    lines.push(
      `Open: the ${KINDS[open.type as Kind]?.one ?? open.type} "${open.name}" (${page.source(open)}${open.on ? "" : ", switched off"})${where ? `, file ${where}` : ", which ships with PiSpark and can't be changed"}.` +
        (reach ? ` It's shared: ${reach} agents use it, so changing it changes them all.` : ""),
    );
  } else if (kind) lines.push(`Nothing is open: something new goes in ${KINDS[kind].title}.`);
  const byKind = (["instructions", "skills", "prompts", "extensions"] as Kind[])
    .map((kind) => {
      const items = view.items.filter((item) => item.type === kind);
      return items.length ? `${KINDS[kind].title}: ${items.map((item) => `${item.name} (${page.source(item)}${item.on ? "" : ", off"})`).join(", ")}.` : "";
    })
    .filter(Boolean);
  if (byKind.length) lines.push(`Its items. ${byKind.join(" ")}`);
  return lines.join("\n");
}
/** Why a message to Agent Builder waits: it reads saved files, so unsaved text comes first. */
export function unsavedReason(page: AgentPage, open: Row | undefined): string | undefined {
  if (!open) return undefined;
  if (isFresh(open)) {
    const typed = open.draft.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
    return typed ? "Save or discard the new one first. Agent Builder works on saved files." : undefined;
  }
  return page.dirty(open) ? `Save or discard your changes to ${open.name} first.` : undefined;
}
/** What the agent has now, to tell afterwards what a reply made. */
export function itemKeys(page: AgentPage): Set<string> {
  return new Set((page.view?.items ?? []).map((item) => keyOf(item)));
}
/**
 * Agent Builder's reply ended: read the agent again (texts too, unless being edited) and open
 * anything new it made, in place of an empty new one.
 */
export async function afterReply(page: AgentPage, before: Set<string>) {
  await page.client.load();
  void page.client.refresh();
  for (const [key, text] of Object.entries(page.texts)) if (text.draft === text.saved) delete page.texts[key];
  for (const item of page.view?.items ?? []) {
    const kind = item.type as Kind;
    if (before.has(keyOf(item)) || !(kind in KINDS)) continue;
    const fresh = page.fresh[kind];
    if (fresh && (!fresh.name || fresh.name === item.name)) page.fresh[kind] = undefined;
    page.open[kind] = keyOf(item);
    await page.load(item);
  }
  for (const kind of Object.keys(KINDS) as Kind[]) {
    const open = page.opened(kind, false);
    if (open && !isFresh(open)) await page.load(open);
  }
}
