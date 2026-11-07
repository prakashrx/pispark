<script lang="ts">
  import { untrack } from "svelte";
  import FormField from "../../lib/ui/FormField.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import InlinePanel from "../../lib/ui/InlinePanel.svelte";
  import PersonaDetails from "./PersonaDetails.svelte";
  import type { PersonaClient } from "./persona-client.svelte";
  let {
    client,
    creating,
    onclose,
    oncreated,
  }: {
    client: PersonaClient;
    creating: boolean;
    onclose: () => void;
    oncreated: () => void;
  } = $props();
  let name = $state(
    untrack(() => (creating ? "" : (client.draft?.name ?? ""))),
  );
  let description = $state(
    untrack(() => (creating ? "" : (client.draft?.description ?? ""))),
  );
  const formId = $props.id();
  async function submit() {
    if (!name.trim() || client.busy) return;
    if (creating) {
      if (await client.create(name, description)) {
        oncreated();
        onclose();
      }
    } else if (client.draft) {
      client.draft.name = name.trim();
      client.draft.description = description;
      onclose();
    }
  }
</script>

<InlinePanel
  label={creating ? "New persona" : "Edit name and description"}
  title={creating ? "New persona" : "Edit name and description"}
  size="small"
  busy={client.busy}
  {onclose}
>
  <form
    id={formId}
    class="space-y-4"
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}
  >
    <FormField label="Name" required
      >{#snippet children(id, describedby)}<Input
          {id}
          aria-describedby={describedby}
          required
          disabled={client.busy}
          bind:value={name}
          maxlength={120}
        />{/snippet}</FormField
    >
    <FormField label="Description"
      >{#snippet children(id, describedby)}<Textarea
          {id}
          aria-describedby={describedby}
          disabled={client.busy}
          bind:value={description}
          maxlength={1024}
          rows={3}
        />{/snippet}</FormField
    >
    {#if creating}<PersonaDetails
        error={client.editorError}
        context="draft"
      />{:else}<p class="text-sm text-muted-foreground">
        Save changes in the editor to keep these edits.
      </p>{/if}
  </form>
  {#snippet footer()}
    <Button disabled={client.busy} onclick={onclose}>Cancel</Button><Button
      variant="primary"
      type="submit"
      form={formId}
      loading={client.busy}
      disabled={!name.trim()}
      >{creating ? "Create persona" : "Apply changes"}</Button
    >
  {/snippet}
</InlinePanel>
