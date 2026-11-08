<script lang="ts">
  import PersonaDetails from "./PersonaDetails.svelte";
  import { onMount, untrack } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import FormField from "../../lib/ui/FormField.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import type { PersonaRef } from "../../../../server/src/persona-protocol";
  import { personaRequest, type PersonaClient } from "./persona-client.svelte";
  let {
    reference,
    path,
    client,
    declared,
    readonly = false,
  }: {
    reference: PersonaRef;
    path: string;
    client: PersonaClient;
    declared: boolean;
    readonly?: boolean;
  } = $props();
  // Parent keys this editor by reference/path; drafts themselves survive route/component disposal.
  const file = untrack(() => client.file(reference, path));
  async function load() {
    if (file.dirty && !window.confirm("Discard unsaved instruction file text?"))
      return;
    file.busy = true;
    file.error = "";
    try {
      const result = await personaRequest<{ text: string; revision: string }>(
        "instruction/read",
        { ref: reference, path },
      );
      file.content = result.text;
      file.baseline = result.text;
      file.revision = result.revision;
      file.loaded = true;
      file.status = "File loaded";
    } catch (e) {
      file.error = (e as Error).message;
    } finally {
      file.busy = false;
    }
  }
  // Opening the editor shows the file: load it unless a retained draft is already here.
  onMount(() => {
    if (declared && !file.loaded && !file.dirty && !file.busy && !file.blocked)
      void load();
  });
  async function save() {
    file.busy = true;
    file.error = "";
    const submitted = file.content,
      target = reference,
      expectedManagementRevision = client.view?.revision;
    try {
      const result = await personaRequest<{
        fileRevision: string;
        beforeRevision?: string;
        revision?: string;
      }>("instruction", {
        ref: target,
        path,
        expectedRevision: file.revision,
        text: submitted,
      });
      file.revision = result.fileRevision;
      file.baseline = submitted;
      file.loaded = true;
      file.status = "File saved.";
      await client.fileSaved(
        target,
        result.revision,
        expectedManagementRevision,
        result.beforeRevision,
      );
    } catch (e) {
      file.error = `${(e as Error).message}. File draft retained.`;
    } finally {
      file.busy = false;
    }
  }
</script>

<!-- Lives inside the "Edit file" editor of its prompt row: no extra disclosure level. -->
<div class="space-y-3">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <p class="text-sm">
      <span class="font-mono">{path}</span>
      <span class="text-muted-foreground">
        · {readonly ? "Read-only file" : "Saved separately from the persona"}{file.dirty
          ? " · Unsaved changes"
          : ""}</span
      >
    </p>
    {#if declared}<Button
        variant="ghost"
        size="compact"
        disabled={file.busy || file.blocked}
        onclick={load}>Load file</Button
      >{/if}
  </div>
  {#if !declared}<p class="text-sm text-muted-foreground">
      Save file contents here, then save the persona to add this file.
    </p>{/if}
  {#if file.loaded || !declared}
    <FormField label="Contents"
      >{#snippet children(id, describedby)}<Textarea
          {id}
          aria-describedby={describedby}
          aria-label={`File text: ${path}`}
          rows={8}
          bind:value={file.content}
          disabled={readonly || file.busy || file.blocked}
        />{/snippet}</FormField
    >
  {:else if file.busy}<p role="status" class="text-sm text-muted-foreground">
      Loading file…
    </p>{/if}
  <PersonaDetails
    error={file.error}
    context="file"
    retainedEdits={file.dirty}
  />
  <div class="flex flex-wrap items-center justify-end gap-3">
    <p role="status" class="mr-auto text-sm text-muted-foreground">{file.status}</p>
    {#if file.loaded || !declared}<Button
        variant="primary"
        disabled={readonly ||
          file.busy ||
          file.blocked ||
          !file.content.trim() ||
          !file.dirty}
        onclick={save}>Save file</Button
      >{/if}
  </div>
</div>
