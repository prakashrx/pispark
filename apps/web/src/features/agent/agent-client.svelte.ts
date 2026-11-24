import {
  switchName,
  type ItemFile,
  type ItemType,
  type AgentDefinition,
  type AgentSummary,
  type AgentTarget,
  type AgentView,
  type ItemTarget,
  type AvailableResource,
  type ResourceReference,
  type ResolvedItem,
} from "../../../../server/src/contract/agent-protocol";
import { agentError } from "./agent-presentation";
import { go } from "../../routes";

export async function agentRequest<T>(
  operation: string,
  input?: unknown,
): Promise<T> {
  const response = await fetch(
    `/api/agents${operation ? `/${operation}` : ""}`,
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
    throw new Error(agentError(result.error ?? "storage", result.detail));
  return result as T;
}

export const sameTarget = (a?: AgentTarget, b?: AgentTarget) =>
  !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
const layerId = (target: AgentTarget) =>
  "agent" in target ? target.agent : "session";

/**
 * Agent list, the Ask selection and the open editor. Every change is saved as it is made;
 * the server resolves the layers and returns the new view.
 */
export class AgentClient {
  items = $state<AgentSummary[]>([]);
  loading = $state(false);
  error = $state("");
  /** Agent chosen in Ask; Default when empty. */
  selected = $state("default");
  mode = $state<"collection" | "editor">("collection");
  target = $state<AgentTarget>();
  view = $state<AgentView>();
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
        await agentRequest<{ agents: AgentSummary[] }>("")
      ).agents;
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
  async open(target: AgentTarget) {
    this.target = target;
    this.mode = "editor";
    this.editorError = "";
    this.status = "";
    await this.load(target);
  }
  async load(target = this.target) {
    if (!target) return;
    try {
      const view = await agentRequest<AgentView>("read", { target });
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
  private save(definition: AgentDefinition) {
    return agentRequest<{ revision: string }>("save", {
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
        await agentRequest<{ id: string }>("create", {
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
    go({ name: "agents", id });
    return id;
  }
  updateDefinition(update: (definition: AgentDefinition) => AgentDefinition) {
    const view = this.view;
    if (!view) return Promise.resolve(false);
    return this.change(() => this.save(update($state.snapshot(view.definition) as AgentDefinition)));
  }
  /**
   * Switch an item or tool on or off in this layer. The least change is tried first
   * (dropping this layer's own switch); an explicit switch is added only if still needed.
   */
  async toggle(type: ItemType | "tool", name: string, on: boolean) {
    const key = switchName(type, name);
    const strip = (d: AgentDefinition) => {
      const next: AgentDefinition = {
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
  availableResources(type: ItemType) {
    return agentRequest<{ resources: AvailableResource[] }>("resources", { target: this.target, type });
  }
  selectResource(type: ItemType, reference: ResourceReference, on: boolean) {
    return this.change(() => agentRequest("resource/select", {
      target: this.target,
      expectedRevision: this.view?.revision ?? "",
      type,
      reference,
      on,
    }), on ? "Added" : "Removed");
  }
  readFile(path: string, target: ItemTarget | undefined = this.target) {
    return agentRequest<ItemFile>("file/read", { target, path });
  }
  /** Create or replace an item file in this layer, or in the Shared library. */
  writeFile(path: string, text: string, revision: string | null, target: ItemTarget | undefined = this.target, done = "Saved") {
    return this.change(
      () =>
        agentRequest<ItemFile>("file/write", {
          target,
          path,
          expectedRevision: revision,
          text,
        }),
      done,
    );
  }
  /** Write a new file into the Shared library and select it here, as one change. */
  addShared(type: ItemType, name: string, path: string, text: string) {
    return this.change(async () => {
      await agentRequest<ItemFile>("file/write", { target: { library: "shared" }, path, expectedRevision: null, text });
      const { revision } = await agentRequest<AgentView>("read", { target: this.target });
      await agentRequest("resource/select", { target: this.target, type, reference: `shared:${name}`, on: true, expectedRevision: revision });
    }, "Saved to the Shared library");
  }
  /** The agent's Agent Builder session: the one it has, or a new one; `fresh` puts the last away. */
  async builder(agent: string, fresh = false): Promise<string> {
    return (await agentRequest<{ session: string }>("builder", { agent, ...(fresh ? { fresh: true } : {}) })).session;
  }
  /** "Open as a session": the Agent Builder session joins the session list. */
  release(session: string) {
    return agentRequest("builder/release", { session });
  }
  /** Move one of this agent's own items into the Shared library. */
  promote(type: ItemType, name: string) {
    return this.change(
      () => agentRequest("resource/promote", { target: this.target, type, name, expectedRevision: this.view?.revision ?? "" }),
      "Moved to the Shared library",
    );
  }
  async deleteFile(path: string) {
    return this.change(async () => {
      const current = await this.readFile(path);
      await agentRequest("file/delete", {
        target: this.target,
        path,
        expectedRevision: current.revision,
      });
    }, "Removed");
  }
  /** Copy an inherited item into this layer, where it replaces the original by name. */
  async customize(item: ResolvedItem) {
    if (!item.path || !this.view) return false;
    const source = await this.readFile(item.path, this.fileTarget(item));
    return this.writeFile(item.path, source.text, null);
  }
  /** Where an item's file lives: the Shared library, the app's own resources, or its origin layer. */
  fileTarget(item: ResolvedItem): ItemTarget | undefined {
    if (item.reference?.startsWith("shared:")) return { library: "shared" };
    if (item.reference?.startsWith("bundled:")) return { library: "bundled" };
    return item.origin.id === "session" || this.local(item) ? this.target : { agent: item.origin.id };
  }
  async remove(id: string) {
    const ok = await this.change(() => agentRequest("delete", { id }), "Deleted");
    if (ok) {
      this.mode = "collection";
      this.view = undefined;
      this.target = undefined;
      go({ name: "agents" });
    }
    return ok;
  }
  /** Whether an item comes from the layer being edited. */
  local(item: { origin: { id: string } }) {
    return !!this.target && item.origin.id === layerId(this.target);
  }
  /** Whether the layer being edited owns the item's file, not just a reference to a shared or bundled one. */
  owns(item: ResolvedItem) {
    return this.local(item) && (!item.reference || item.reference.startsWith("local:"));
  }
}
