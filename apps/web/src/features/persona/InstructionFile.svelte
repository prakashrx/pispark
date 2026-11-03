<script lang="ts">
  import PersonaDetails from "./PersonaDetails.svelte";
  import { untrack } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
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

{#if file.dirty}<p class="text-xs">This file has unsaved changes.</p>{/if}
<details class="text-xs space-y-2">
  <summary class="cursor-pointer"
    >{readonly ? "View file" : "Edit file"}
    {file.dirty ? "· Unsaved changes" : ""}</summary
  >
  <p class="text-neutral-500">
    {declared
      ? "File contents are saved separately."
      : "Save file contents here, then save the persona to add this file."}
  </p>
  {#if declared}<Button
      class="source-action"
      disabled={file.busy || file.blocked}
      onclick={load}>Load file</Button
    >{/if}
  {#if file.loaded || !declared}
    <Textarea
      label={`File text: ${path}`}
      rows={5}
      class="source-input"
      bind:value={file.content}
      disabled={readonly || file.busy || file.blocked}
    />
    <Button
      class="persona-add"
      disabled={readonly ||
        file.busy ||
        file.blocked ||
        !file.content.trim() ||
        !file.dirty}
      onclick={save}>Save file</Button
    >
  {/if}
  <PersonaDetails
    error={file.error}
    context="file"
    retainedEdits={file.dirty}
  />
  <p role="status">{file.status}</p>
</details>
