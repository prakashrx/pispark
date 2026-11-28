/**
 * The agent page's state over the agent client: what each tab has open, each item's text as saved
 * and as being edited, and the rules for where saving goes. The server resolves the agent; this
 * only decides what the page shows and which request a choice sends.
 */
import type { AgentTarget, ItemType, ResolvedItem } from "../../../../server/src/contract/agent-protocol";
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
/** An entry in an item's ⋯ menu. */
export type Entry = { id: string; label: string; onselect: () => void; destructive?: boolean };
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

  /** The layer the page edits: an agent's ID, or "session" for a session's own layer. */
  readonly agent: string;
  /** How the page names that layer: "this agent" or "this session". */
  readonly here: string;
  constructor(
    readonly client: AgentClient,
    readonly target: AgentTarget,
  ) {
    this.agent = "agent" in target ? target.agent : "session";
    this.here = "agent" in target ? "this agent" : "this session";
  }

  get view() {
    return this.client.view;
  }
  /** Shipped with the app: everything can be read, nothing changed. */
  get readOnly() {
    return "agent" in this.target && !!this.client.items.find((summary) => summary.id === this.agent)?.bundled;
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
    return this.readOnly ? "Bundled" : `Only ${this.here}`;
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
  /** Anything unsaved on the page: closing the browser tab asks first. */
  get changed(): boolean {
    return Object.values(this.fresh).some(Boolean) || Object.values(this.texts).some((text) => text.draft !== text.saved);
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
    const ok = await this.client.writeFile(
      item.path,
      text.draft,
      text.revision,
      this.client.fileTarget(item),
      shared && this.reach(item) ? `Saved for ${this.reach(item)} agents` : "Saved",
    );
    if (ok) await this.load(item, true);
  }
  /** Save the change as this agent's own copy (the whole item); the shared one stays as it was. */
  async saveCopy(item: Row) {
    if (isFresh(item) || !item.path) return;
    const draft = this.texts[keyOf(item)]?.draft;
    if (draft === undefined || !(await this.client.customize(item))) return;
    delete this.texts[keyOf(item)];
    const own = this.view?.items.find((next) => next.type === item.type && next.name === item.name);
    if (!own?.path) return;
    await this.load(own);
    const copied = this.texts[keyOf(own)];
    if (copied && (await this.client.writeFile(own.path, draft, copied.revision, this.client.target, `Saved ${this.here}'s own copy`)))
      await this.load(own, true);
  }
  /** Save something new: to the Shared library (any agent can add it), or for this agent only. */
  async saveNew(item: Fresh, where: "shared" | "agent") {
    if (!NAME.test(item.name)) return false;
    const path = pathOf(item.type, item.name);
    const ok =
      where === "shared"
        ? await this.client.addShared(item.type, item.name, path, item.draft)
        : await this.client.writeFile(path, item.draft, null, this.client.target, `Saved for ${this.here}`);
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
  /** The ⋯ menu every tab shares, after the tab's own entries. */
  entries(item: Row, extra: Entry[] = []): Entry[] {
    if (isFresh(item) || this.readOnly) return [];
    const one = KINDS[item.type as Kind]?.one ?? "item";
    const list = [...extra];
    if (this.owns(item)) list.push({ id: "promote", label: "Move to Shared library", onselect: () => void this.promote(item) });
    else if (item.type !== "extensions")
      list.push({ id: "own", label: `Make it ${this.here}'s own`, onselect: () => void this.makeOwn(item) });
    const how = this.removable(item);
    if (how)
      list.push({
        id: "remove",
        label: how === "delete" ? `Delete ${one}` : `Remove from ${this.here}`,
        destructive: true,
        onselect: () => void this.remove(item),
      });
    return list;
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

/** Rough size of what's read every session. */
export const words = (text: string) =>
  text
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
    .replace(/[#*`>|-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
