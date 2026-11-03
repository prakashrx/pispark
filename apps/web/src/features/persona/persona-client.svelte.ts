import type { PersonaErrorContext } from "./persona-presentation";
import type {
  PersonaDefinition,
  PersonaDiagnostic,
  PersonaDocument,
  PersonaRef,
  PersonaSelection,
  PersonaSummary,
  PersonaView,
} from "../../../../server/src/persona-protocol";
export async function personaRequest<T>(
  operation: string,
  input?: unknown,
): Promise<T> {
  const response = await fetch(
    `/api/personas${operation ? `${operation.startsWith("?") ? "" : "/"}${operation}` : ""}`,
    input === undefined
      ? { signal: AbortSignal.timeout(12_000) }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(12_000),
        },
  );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No server response");
  const decoder = new TextDecoder();
  let text = "",
    size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512 * 1024) throw new Error("Response limit");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  const result = JSON.parse(text + decoder.decode());
  if (!response.ok) {
    const diagnostics = (
      Array.isArray(result.diagnostics) ? result.diagnostics : []
    ) as PersonaDiagnostic[];
    const detail = diagnostics
      .slice(0, 16)
      .map((d) =>
        [
          d.resourceType,
          d.resourceId,
          d.field,
          d.refs?.map((r) => `${r.root}/${r.path}`).join(", "),
        ]
          .filter(Boolean)
          .join(" "),
      )
      .filter(Boolean)
      .join("; ")
      .slice(0, 2048);
    throw new Error(
      `${result.error ?? "Request failed"}${detail ? `: ${detail}` : ""}${result.requestId ? ` (${result.requestId})` : ""}`,
    );
  }
  return result as T;
}
export const personaKey = (ref: PersonaRef) => JSON.stringify(ref);
type PersonaDraft = PersonaDefinition &
  Required<
    Pick<PersonaDefinition, "instructions" | "skills" | "parents" | "exclude">
  >;
function editable(value: PersonaDefinition): PersonaDraft {
  return {
    ...value,
    instructions: value.instructions ?? [],
    skills: value.skills ?? [],
    parents: value.parents ?? [],
    exclude: value.exclude ?? {},
  };
}
export class InstructionDraft {
  blocked = false;
  content = $state("");
  baseline = $state("");
  revision = $state<string | null>(null);
  loaded = $state(false);
  busy = $state(false);
  error = $state("");
  status = $state("");
  get dirty() {
    return this.content !== this.baseline;
  }
}
export class PersonaClient {
  private files = new Map<string, InstructionDraft>();
  file(reference: PersonaRef, path: string): InstructionDraft {
    const key = `${personaKey(reference)}/${path}`;
    let file = this.files.get(key);
    if (!file) {
      if (this.files.size >= 32) {
        const clean = [...this.files].find(([, f]) => !f.dirty && !f.busy);
        if (clean) this.files.delete(clean[0]);
        else {
          const blocked = new InstructionDraft();
          blocked.blocked = true;
          blocked.error = "file-draft-limit";
          return blocked;
        }
      }
      file = new InstructionDraft();
      this.files.set(key, file);
    }
    return file;
  }
  get hasUnsavedFiles() {
    return [...this.files.values()].some((f) => f.dirty || f.busy);
  }
  items = $state<PersonaSummary[]>([]);
  selected = $state("");
  loading = $state(false);
  error = $state("");
  inspectedSummary = $state<PersonaSummary>();
  view = $state<PersonaDocument>();
  draft = $state<PersonaDraft>();
  effective = $state<PersonaDocument>();
  savedJSON = $state("");
  status = $state("");
  notice = $state("");
  editorError = $state("");
  editorErrorContext = $state<PersonaErrorContext>("document");
  busy = $state(false);
  reading = $state(false);
  dirty = $derived(
    !!this.draft && JSON.stringify(this.draft) !== this.savedJSON,
  );
  private generation = 0;
  private refreshGeneration = 0;
  async refresh() {
    const generation = ++this.refreshGeneration;
    this.loading = true;
    try {
      const items: PersonaSummary[] = [];
      let cursor: string | undefined;
      do {
        const result = await personaRequest<{
          personas: PersonaSummary[];
          nextCursor?: string;
        }>(cursor ? `?cursor=${cursor}` : "");
        items.push(...result.personas);
        cursor = result.nextCursor;
        if (items.length > 256) throw new Error("Persona collection limit");
      } while (cursor);
      if (generation === this.refreshGeneration) {
        this.items = items;
        this.error = "";
      }
    } catch (error) {
      if (generation === this.refreshGeneration)
        this.error = (error as Error).message;
    } finally {
      if (generation === this.refreshGeneration) this.loading = false;
    }
  }
  get selection(): PersonaSelection | undefined {
    const item = this.items.find((p) => personaKey(p.ref) === this.selected);
    return item?.valid && item.revision
      ? { ...item.ref, revision: item.revision }
      : undefined;
  }
  async select(reference: PersonaRef, discard = false) {
    if (
      this.dirty &&
      !discard &&
      !window.confirm("Discard unsaved persona changes?")
    )
      return;
    const generation = ++this.generation;
    this.reading = true;
    this.editorError = "";
    this.notice = "";
    this.editorErrorContext = "document";
    const summary = this.items.find(
      (p) => personaKey(p.ref) === personaKey(reference),
    );
    if (
      summary?.diagnostics.some((d) =>
        ["invalid-definition", "unsupported-version"].includes(d.code),
      ) ||
      !reference.id
    ) {
      this.inspectedSummary = summary;
      this.view = undefined;
      this.draft = undefined;
      this.effective = undefined;
      this.savedJSON = "";
      this.status =
        "Invalid document — repair on the backend host; editing unavailable";
      this.reading = false;
      return;
    }
    const previousDraft = JSON.stringify(this.draft);
    try {
      const view = await personaRequest<PersonaDocument>("read", {
        ref: reference,
      });
      if (generation !== this.generation) return;
      if (JSON.stringify(this.draft) !== previousDraft) {
        this.editorError =
          "Draft changed while loading; selection cancelled. Draft retained.";
        return;
      }
      this.inspectedSummary = summary;
      this.view = view;
      this.draft = editable(structuredClone(view.definition));
      this.savedJSON = JSON.stringify(this.draft);
      this.effective = view;
      this.status = view.diagnostics.length
        ? "Saved definition has resource errors"
        : view.writable
          ? "Saved"
          : "Read-only";
    } catch (error) {
      if (generation === this.generation)
        this.editorError = (error as Error).message;
    } finally {
      if (generation === this.generation) this.reading = false;
    }
  }
  async create(name: string) {
    if (
      !name.trim() ||
      this.busy ||
      (this.dirty && !window.confirm("Discard unsaved persona changes?"))
    )
      return;
    this.busy = true;
    this.editorError = "";
    this.notice = "";
    this.editorErrorContext = "draft";
    const previousDraft = JSON.stringify(this.draft),
      generation = this.generation;
    try {
      const view = await personaRequest<PersonaView>("create", {
        definition: { schemaVersion: 1, name: name.trim() },
      });
      await this.refresh();
      if (
        generation === this.generation &&
        JSON.stringify(this.draft) === previousDraft
      )
        await this.select(view.ref, true);
      else if (generation === this.generation)
        this.notice =
          "Persona created. Your current edits are still here. Choose the new persona from the list when you’re ready.";
    } catch (error) {
      if (generation === this.generation)
        this.editorError = (error as Error).message;
    } finally {
      this.busy = false;
    }
  }
  async validate() {
    if (!this.view || !this.draft || this.busy || this.reading) return;
    const generation = this.generation,
      submitted = JSON.stringify(this.draft);
    this.busy = true;
    this.editorError = "";
    this.notice = "";
    this.editorErrorContext = "draft";
    try {
      const effective = await personaRequest<PersonaView>("validate", {
        ref: this.view.ref,
        definition: JSON.parse(submitted),
      });
      if (
        generation === this.generation &&
        JSON.stringify(this.draft) === submitted
      ) {
        this.effective = effective;
        this.status = "Changes checked. Not saved yet.";
      }
    } catch (error) {
      if (generation === this.generation)
        this.editorError = (error as Error).message;
    } finally {
      this.busy = false;
    }
  }
  async save() {
    if (
      !this.view?.writable ||
      !this.draft ||
      this.busy ||
      this.reading ||
      !this.view.revision
    )
      return;
    const generation = this.generation,
      submitted = JSON.stringify(this.draft),
      reference = this.view.ref;
    this.busy = true;
    this.editorError = "";
    this.notice = "";
    this.editorErrorContext = "draft";
    this.status = "Saving";
    try {
      const view = await personaRequest<PersonaView>("save", {
        ref: reference,
        expectedRevision: this.view.revision,
        definition: JSON.parse(submitted),
      });
      if (generation === this.generation) {
        this.view = view;
        this.savedJSON = submitted;
        this.effective = view;
        this.status = "Saved";
      }
      await this.refresh();
    } catch (error) {
      if (generation === this.generation) {
        this.editorError = `${(error as Error).message}. Draft retained. Reload deliberately to discard it.`;
        this.status = "Not saved";
      }
    } finally {
      this.busy = false;
    }
  }
  async fileSaved(
    reference: PersonaRef,
    revision?: string,
    expectedManagementRevision?: string,
    beforeRevision?: string,
  ) {
    this.notice = "";
    if (
      this.view &&
      personaKey(this.view.ref) === personaKey(reference) &&
      this.view.revision === expectedManagementRevision
    ) {
      if (
        expectedManagementRevision &&
        beforeRevision === expectedManagementRevision &&
        revision
      ) {
        this.view = { ...this.view, revision };
        this.status = this.dirty
          ? "File saved. Persona changes are not saved yet."
          : "Saved";
      } else {
        this.view = { ...this.view, revision: undefined };
        this.editorError =
          "The file was saved, but this persona changed elsewhere. Your other edits are safe. Reload the saved version before saving the persona.";
        this.status = "Review saved changes";
      }
    }
    await this.refresh();
  }
}
