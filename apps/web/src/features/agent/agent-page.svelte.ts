/**
 * The agent page's state over the agent client: what each tab has open, each item's text as saved
 * and as being edited, and the rules for where saving goes. The server resolves the agent; this
 * only decides what the page shows and which request a choice sends.
 */
import type { ItemType, ResolvedItem } from "../../../../server/src/contract/agent-protocol";
import type { AgentClient } from "./agent-client.svelte";
import { withField } from "./frontmatter";

export type Kind = "instructions" | "skills" | "prompts" | "extensions";
export const KINDS: Record<Kind, { title: string; one: string }> = {
  instructions: { title: "Instructions", one: "instruction" },
  skills: { title: "Skills", one: "skill" },
  prompts: { title: "Prompts", one: "prompt" },
  extensions: { title: "Extensions", one: "extension" },
};
export const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Something new in a tab, not saved anywhere yet. */
export interface Fresh {
  type: Kind;
  name: string;
  draft: string;
}
/** A row in a tab: a resolved item, or the new one. */
export type Row = ResolvedItem | Fresh;
export const isFresh = (row: Row): row is Fresh => !("origin" in row);
export const keyOf = (row: Row) => (isFresh(row) ? `${row.type}/new` : `${row.type}/${row.name}`);

interface Text {
  saved: string;
  draft: string;
  /** The saved file's revision, when this agent may write it. */
  revision: string | null;
  loading: boolean;
  error: string;
}

/** Where a new item's file goes. */
const pathOf = (type: ItemType, name: string) => (type === "skills" ? `skills/${name}/SKILL.md` : `${type}/${name}.md`);

export class AgentPage {
  /** What each tab has open: an item's key, or instructions' "all". */
  open = $state<Partial<Record<Kind, string>>>({});
  fresh = $state<Partial<Record<Kind, Fresh>>>({});
  texts = $state<Record<string, Text>>({});

  constructor(
    readonly client: AgentClient,
    readonly agent: string,
  ) {}

  get view() {
    return this.client.view;
  }
  /** Shipped with the app: everything can be read, nothing changed. */
  get readOnly() {
    return !!this.client.items.find((summary) => summary.id === this.agent)?.bundled;
  }

  /** A tab's rows in the order they show. Instructions: what's read, in order, then what's off. */
  rows(kind: Kind): Row[] {
    const items = (this.view?.items ?? []).filter((item) => item.type === kind);
    const fresh = this.fresh[kind];
    if (kind === "instructions") {
      const on = items.filter((item) => item.on);
      return [...on, ...(fresh ? [fresh] : []), ...items.filter((item) => !item.on)];
    }
    if (kind === "prompts") return [...(fresh ? [fresh] : []), ...items];
    return [...items, ...(fresh ? [fresh] : [])];
  }
  /** What's open in a tab: what was picked, else the first where there's room. Extensions open only when picked. */
  opened(kind: Kind, narrow: boolean): Row | undefined {
    const rows = this.rows(kind);
    const picked = this.open[kind];
    if (picked === "all") return undefined;
    const found = picked ? rows.find((row) => keyOf(row) === picked) : undefined;
    if (found) return found;
    return narrow || kind === "extensions" ? undefined : rows[0];
  }
  show(kind: Kind, row: Row | "all" | undefined) {
    this.open[kind] = row === "all" ? "all" : row ? keyOf(row) : undefined;
    if (row && row !== "all" && !isFresh(row)) void this.load(row);
  }

  /** The layer this page edits owns the file: it can be written here. */
  owns(item: Row): boolean {
    if (isFresh(item)) return true;
    return !this.readOnly && item.origin.id === this.agent && (!item.reference || item.reference.startsWith("local:"));
  }
  /** Can be changed from this page: its own, or a shared one (saved for all or as a copy). */
  editable(item: Row): boolean {
    if (this.readOnly) return false;
    if (isFresh(item) || this.owns(item)) return true;
    return item.origin.id === this.agent && !!item.reference?.startsWith("shared:");
  }
  /** Shared and used by more than this agent: saving reaches them too. */
  reach(item: Row): number | undefined {
    return !isFresh(item) && item.reference?.startsWith("shared:") && (item.usedBy ?? 0) > 1 ? item.usedBy : undefined;
  }
  /** Where it comes from, quietly. */
  source(item: Row): string {
    if (isFresh(item)) return "Not saved";
    if (item.origin.id !== this.agent) return `From ${item.origin.name}`;
    if (item.reference?.startsWith("bundled:")) return "Bundled";
    if (item.reference?.startsWith("shared:")) return item.usedBy && item.usedBy > 1 ? `Shared · ${item.usedBy} agents` : "Shared";
    return this.readOnly ? "Bundled" : "Only this agent";
  }

  text(item: Row): Text | undefined {
    if (isFresh(item)) return { saved: "", draft: item.draft, revision: null, loading: false, error: "" };
    return this.texts[keyOf(item)];
  }
  /** The text being edited (or saved, when nothing changed). */
  draft(item: Row): string {
    return this.text(item)?.draft ?? "";
  }
  setDraft(item: Row, draft: string) {
    if (isFresh(item)) {
      const fresh = this.fresh[item.type];
      if (fresh) fresh.draft = draft;
      return;
    }
    const text = this.texts[keyOf(item)];
    if (text) text.draft = draft;
  }
  dirty(item: Row): boolean {
    if (isFresh(item)) return true;
    const text = this.texts[keyOf(item)];
    return !!text && text.draft !== text.saved;
  }
  async load(item: ResolvedItem, force = false) {
    if (!item.path) return;
    const key = keyOf(item);
    if (this.texts[key] && !force) return;
    this.texts[key] = { saved: "", draft: "", revision: null, loading: true, error: "" };
    try {
      const file = await this.client.readFile(item.path, this.client.fileTarget(item));
      this.texts[key] = { saved: file.text, draft: file.text, revision: file.revision, loading: false, error: "" };
    } catch (error) {
      this.texts[key] = { saved: "", draft: "", revision: null, loading: false, error: (error as Error).message };
    }
  }

  /** Something new in a tab, opened for naming and writing. */
  create(kind: Kind): Fresh {
    const draft = kind === "skills" ? "---\nname: \ndescription: \n---\n\n" : kind === "prompts" ? "---\ndescription: \n---\n\n" : "";
    this.fresh[kind] = { type: kind, name: "", draft };
    this.open[kind] = `${kind}/new`;
    return this.fresh[kind]!;
  }
  rename(item: Fresh, name: string) {
    const fresh = this.fresh[item.type];
    if (!fresh) return;
    fresh.name = name;
    if (fresh.type === "skills") fresh.draft = withField(fresh.draft, "name", name);
  }
  discard(item: Row) {
    if (isFresh(item)) {
      this.fresh[item.type] = undefined;
      this.open[item.type] = undefined;
      return;
    }
    const text = this.texts[keyOf(item)];
    if (text) text.draft = text.saved;
  }

  /** Save: its own file, or a shared one for every agent that uses it. */
  async save(item: Row) {
    if (isFresh(item) || !item.path) return;
    const text = this.texts[keyOf(item)];
    if (!text) return;
    const shared = item.reference?.startsWith("shared:");
    const ok = await this.client.writeFile(item.path, text.draft, text.revision, this.client.fileTarget(item), shared && this.reach(item) ? `Saved for ${this.reach(item)} agents` : "Saved");
    if (ok) await this.load(item, true);
  }
  /** Save the change as this agent's own copy; the shared one stays as it was. */
  async saveCopy(item: Row) {
    if (isFresh(item) || !item.path) return;
    const text = this.texts[keyOf(item)];
    if (!text) return;
    const ok = await this.client.writeFile(item.path, text.draft, null, this.client.target, "Saved this agent's own copy");
    if (ok) {
      delete this.texts[keyOf(item)];
      const own = this.view?.items.find((next) => next.type === item.type && next.name === item.name);
      if (own) await this.load(own);
    }
  }
  /** Save something new: to the Shared library (any agent can add it), or for this agent only. */
  async saveNew(item: Fresh, where: "shared" | "agent") {
    if (!NAME.test(item.name)) return false;
    const path = pathOf(item.type, item.name);
    const ok =
      where === "shared"
        ? await this.client.addShared(item.type, item.name, path, item.draft)
        : await this.client.writeFile(path, item.draft, null, this.client.target, "Saved for this agent");
    if (!ok) return false;
    this.fresh[item.type] = undefined;
    this.open[item.type] = `${item.type}/${item.name}`;
    const saved = this.view?.items.find((next) => next.type === item.type && next.name === item.name);
    if (saved) await this.load(saved, true);
    return true;
  }

  /** Copy an inherited, shared or bundled item into this agent, where it replaces the original. */
  async makeOwn(item: ResolvedItem) {
    if (await this.client.customize(item)) {
      delete this.texts[keyOf(item)];
      const own = this.view?.items.find((next) => next.type === item.type && next.name === item.name);
      if (own) await this.load(own);
    }
  }
  /** Delete its own file, or stop selecting a shared or bundled one. Inherited items are only switched off. */
  removable(item: Row): "delete" | "remove" | undefined {
    if (isFresh(item) || this.readOnly || item.origin.id !== this.agent) return undefined;
    return this.owns(item) ? "delete" : item.reference ? "remove" : undefined;
  }
  async remove(item: ResolvedItem) {
    const how = this.removable(item);
    const ok =
      how === "delete" && item.path
        ? await this.client.deleteFile(item.path)
        : how === "remove" && item.reference
          ? await this.client.selectResource(item.type, item.reference, false)
          : false;
    if (ok) {
      delete this.texts[keyOf(item)];
      this.open[item.type as Kind] = undefined;
    }
  }
  // ---- Agent Builder -------------------------------------------------------------------------

  /** An item's text from before Agent Builder changed it, while it waits for Keep or Undo. */
  before = $state<Record<string, string>>({});
  /** What was there when a message went: the open item's text, and which items existed. */
  private sent?: { key?: string; text?: string; items: Set<string>; fresh?: Kind };

  /**
   * What Agent Builder is told with each message: which agent, the tab, what's open and where its
   * file is, and the agent's items. Plain text; the page knows nothing more than it shows.
   */
  note(tab: string, open: Row | undefined): string {
    const view = this.view;
    if (!view) return "";
    const name = view.definition.name ?? this.agent;
    const lines = [`The person is on the agent page of "${name}" (id ${this.agent}), in the ${tab} tab.`];
    if (open && isFresh(open)) {
      const one = KINDS[open.type].one;
      lines.push(
        `Open: a new ${one}, not saved yet${open.name ? `, named "${open.name}"` : ", not named yet"}. Write it in this agent's folder${open.name ? ` as ${open.type === "skills" ? `skills/${open.name}/SKILL.md` : `${open.type}/${open.name}.md`}` : ""} and add it to agent.json's resources as local:<name>.`,
      );
    } else if (open) {
      const where = fileFrom(this, open);
      const reach = this.reach(open);
      lines.push(
        `Open: the ${KINDS[open.type as Kind]?.one ?? open.type} "${open.name}" (${this.source(open)}${open.on ? "" : ", switched off"})${where ? `, file ${where}` : ", which ships with PiSpark and can't be changed"}.` +
          (reach ? ` It's shared: ${reach} agents use it, so changing it changes them all.` : ""),
      );
      if (this.dirty(open)) lines.push("The person has unsaved changes to it in the page.");
    } else if (tab in KINDS) lines.push(`Nothing is open: something new goes in ${KINDS[tab as Kind].title}.`);
    const byKind = (["instructions", "skills", "prompts", "extensions"] as Kind[])
      .map((kind) => {
        const items = view.items.filter((item) => item.type === kind);
        return items.length ? `${KINDS[kind].title}: ${items.map((item) => `${item.name} (${this.source(item)}${item.on ? "" : ", off"})`).join(", ")}.` : "";
      })
      .filter(Boolean);
    if (byKind.length) lines.push(`Its items. ${byKind.join(" ")}`);
    return lines.join("\n");
  }
  /** A message is going: remember the open item's text and what exists, to show what changed. */
  snapshot(open: Row | undefined) {
    const items = new Set((this.view?.items ?? []).map((item) => keyOf(item)));
    if (open && !isFresh(open)) {
      const text = this.texts[keyOf(open)];
      this.sent = { key: keyOf(open), text: text && !text.loading && !text.error ? text.saved : undefined, items };
    } else this.sent = { items, fresh: open && isFresh(open) ? open.type : undefined };
  }
  /** Agent Builder's turn ended: read the agent again, mark what it changed in the open item, open what it made. */
  async afterTurn() {
    const sent = this.sent;
    this.sent = undefined;
    await this.client.load();
    void this.client.refresh();
    const view = this.view;
    if (!view) return;
    // Texts read before may be stale now; read what's open again.
    for (const [key, text] of Object.entries(this.texts)) if (text.draft === text.saved) delete this.texts[key];
    if (sent?.key) {
      const item = view.items.find((next) => keyOf(next) === sent.key);
      if (item) {
        await this.load(item, true);
        const now = this.texts[sent.key]?.saved;
        if (sent.text !== undefined && now !== undefined && now !== sent.text) this.before[sent.key] = sent.text;
      }
    }
    // Something new it wrote: open it in its tab, in place of the unsaved one.
    const made = view.items.filter((item) => !sent?.items.has(keyOf(item)));
    for (const item of made) {
      const kind = item.type as Kind;
      if (!(kind in KINDS)) continue;
      if (this.fresh[kind] && (!this.fresh[kind]!.name || this.fresh[kind]!.name === item.name)) this.fresh[kind] = undefined;
      this.open[kind] = keyOf(item);
      await this.load(item, true);
      if (sent?.fresh === kind || !sent?.key) this.before[keyOf(item)] = "";
    }
  }
  keep(item: Row) {
    delete this.before[keyOf(item)];
  }
  /** Write back what was there before Agent Builder's change. */
  async undo(item: Row) {
    if (isFresh(item) || !item.path) return;
    const key = keyOf(item);
    const was = this.before[key];
    const text = this.texts[key];
    if (was === undefined || !text) return;
    const ok = was === "" && this.owns(item) ? await this.client.deleteFile(item.path) : await this.client.writeFile(item.path, was, text.revision, this.client.fileTarget(item), "Undone");
    if (!ok) return;
    delete this.before[key];
    if (was === "") {
      delete this.texts[key];
      this.open[item.type as Kind] = undefined;
    } else await this.load(item, true);
  }

  promote(item: ResolvedItem) {
    return this.client.promote(item.type, item.name);
  }
  /** This agent's own instructions, in the order it lists them; inherited ones keep their layer's place. */
  movable(item: Row, by: -1 | 1): boolean {
    if (isFresh(item) || item.type !== "instructions" || item.origin.id !== this.agent || this.readOnly) return false;
    const list = this.view?.definition.resources?.instructions ?? [];
    const at = list.findIndex((reference) => reference.endsWith(`:${item.name}`));
    return at >= 0 && at + by >= 0 && at + by < list.length;
  }
  move(item: ResolvedItem, by: -1 | 1) {
    return this.client.updateDefinition((definition) => {
      const list = [...(definition.resources?.instructions ?? [])];
      const at = list.findIndex((reference) => reference.endsWith(`:${item.name}`));
      if (at < 0 || !list[at + by]) return definition;
      [list[at], list[at + by]] = [list[at + by]!, list[at]!];
      return { ...definition, resources: { ...definition.resources, instructions: list } };
    });
  }
}

/** Where an item's file is, seen from the agent's own folder (Agent Builder's working folder). */
export function fileFrom(page: AgentPage, item: ResolvedItem): string | undefined {
  if (!item.path) return undefined;
  if (item.reference?.startsWith("bundled:")) return undefined;
  if (item.reference?.startsWith("shared:")) return `../../resources/${item.path}`;
  return item.origin.id === page.agent ? item.path : `../${item.origin.id}/${item.path}`;
}

/** Rough size of what's read every session. */
export const words = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "").replace(/[#*`>|-]/g, " ").split(/\s+/).filter(Boolean).length;
