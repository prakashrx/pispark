import {
  switchName,
  type ItemFile,
  type ItemType,
  type PersonaDefinition,
  type PersonaSummary,
  type PersonaTarget,
  type PersonaView,
  type ResolvedItem,
} from "../../../../server/src/persona-protocol";
import { personaError } from "./persona-presentation";

export async function personaRequest<T>(
  operation: string,
  input?: unknown,
): Promise<T> {
  const response = await fetch(
    `/api/personas${operation ? `/${operation}` : ""}`,
    input === undefined
      ? { signal: AbortSignal.timeout(12_000) }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(12_000),
        },
  );
  const text = await response.text();
  if (text.length > 512 * 1024) throw new Error("Response limit");
  const result = JSON.parse(text || "{}");
  if (!response.ok)
    throw new Error(personaError(result.error ?? "storage", result.detail));
  return result as T;
}

export const sameTarget = (a?: PersonaTarget, b?: PersonaTarget) =>
  !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
const layerId = (target: PersonaTarget) =>
  "persona" in target ? target.persona : "chat";

/**
 * Persona list, the Ask selection and the open editor. Every change is saved as it is made;
 * the server resolves the layers and returns the new view.
 */
export class PersonaClient {
  items = $state<PersonaSummary[]>([]);
  loading = $state(false);
  error = $state("");
  /** Persona chosen in Ask; Default when empty. */
  selected = $state("default");
  mode = $state<"collection" | "editor">("collection");
  target = $state<PersonaTarget>();
  view = $state<PersonaView>();
  busy = $state(false);
  editorError = $state("");
  status = $state("");
  /** Item editors with unsaved text, by key; the page warns before leaving. */
  drafts = $state<Record<string, boolean>>({});
  get unsaved() {
    return Object.values(this.drafts).some(Boolean);
  }
  async refresh() {
    this.loading = true;
    try {
      this.items = (
        await personaRequest<{ personas: PersonaSummary[] }>("")
      ).personas;
      this.error = "";
      if (
        this.selected &&
        this.items.length &&
        !this.items.some((p) => p.id === this.selected)
      )
        this.selected = "default";
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }
  collection() {
    this.mode = "collection";
  }
  enterRoute() {
    void this.refresh();
  }
  async open(target: PersonaTarget) {
    this.target = target;
    this.mode = "editor";
    this.editorError = "";
    this.status = "";
    await this.load(target);
  }
  async load(target = this.target) {
    if (!target) return;
    try {
      const view = await personaRequest<PersonaView>("read", { target });
      if (sameTarget(target, this.target)) this.view = view;
      return view;
    } catch (error) {
      if (sameTarget(target, this.target))
        this.editorError = (error as Error).message;
    }
  }
  /** Run a change, then refresh the view and list; report errors in the editor. */
  private async change(action: () => Promise<unknown>, done = "Saved") {
    if (this.busy) return false;
    this.busy = true;
    this.editorError = "";
    this.status = "";
    try {
      await action();
      await this.load();
      void this.refresh();
      this.status = done;
      return true;
    } catch (error) {
      this.editorError = (error as Error).message;
      await this.load();
      return false;
    } finally {
      this.busy = false;
    }
  }
  private save(definition: PersonaDefinition) {
    return personaRequest<{ revision: string }>("save", {
      target: this.target,
      expectedRevision: this.view?.revision ?? "",
      definition,
    });
  }
  async create(name: string, description: string, base: string[]) {
    let id = "";
    this.busy = true;
    this.editorError = "";
    try {
      id = (
        await personaRequest<{ id: string }>("create", {
          name,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(base.length ? { base } : {}),
        })
      ).id;
    } catch (error) {
      this.editorError = (error as Error).message;
      return undefined;
    } finally {
      this.busy = false;
    }
    await this.refresh();
    await this.open({ persona: id });
    return id;
  }
  updateDefinition(update: (definition: PersonaDefinition) => PersonaDefinition) {
    const view = this.view;
    if (!view) return Promise.resolve(false);
    return this.change(() => this.save(update(structuredClone(view.definition))));
  }
  /**
   * Switch an item or tool on or off in this layer. The least change is tried first
   * (dropping this layer's own switch); an explicit switch is added only if still needed.
   */
  async toggle(type: ItemType | "tool", name: string, on: boolean) {
    const key = switchName(type, name);
    const strip = (d: PersonaDefinition) => {
      const next: PersonaDefinition = {
        ...d,
        on: (d.on ?? []).filter((s) => s !== key),
        off: (d.off ?? []).filter((s) => s !== key),
      };
      if (!next.on?.length) delete next.on;
      if (!next.off?.length) delete next.off;
      return next;
    };
    const ok = await this.updateDefinition(strip);
    if (!ok || !this.view) return;
    const state =
      type === "tool"
        ? this.view.tools.find((t) => t.name === name)?.on
        : this.view.items.find((i) => i.type === type && i.name === name)?.on;
    if (state === on) return;
    await this.updateDefinition((d) => ({
      ...d,
      [on ? "on" : "off"]: [...((on ? d.on : d.off) ?? []), key],
    }));
  }
  readFile(path: string, target = this.target) {
    return personaRequest<ItemFile>("file/read", { target, path });
  }
  /** Create or replace an item file in this layer. */
  writeFile(path: string, text: string, revision: string | null) {
    return this.change(() =>
      personaRequest<ItemFile>("file/write", {
        target: this.target,
        path,
        expectedRevision: revision,
        text,
      }),
    );
  }
  async deleteFile(path: string) {
    return this.change(async () => {
      const current = await this.readFile(path);
      await personaRequest("file/delete", {
        target: this.target,
        path,
        expectedRevision: current.revision,
      });
    }, "Removed");
  }
  /** Copy an inherited item into this layer, where it replaces the original by name. */
  async customize(item: ResolvedItem) {
    if (!item.path || !this.view) return false;
    const origin: PersonaTarget =
      item.origin.id === "chat" && this.target && "chat" in this.target
        ? this.target
        : { persona: item.origin.id };
    const source = await this.readFile(item.path, origin);
    return this.writeFile(item.path, source.text, null);
  }
  async remove(id: string) {
    const ok = await this.change(() => personaRequest("delete", { id }), "Deleted");
    if (ok) {
      this.mode = "collection";
      this.view = undefined;
      this.target = undefined;
    }
    return ok;
  }
  /** Whether an item comes from the layer being edited. */
  local(item: { origin: { id: string } }) {
    return !!this.target && item.origin.id === layerId(this.target);
  }
}
