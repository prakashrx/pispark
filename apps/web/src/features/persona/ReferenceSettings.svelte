<script lang="ts">
  import Modal from "../../lib/ui/Modal.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import FormField from "../../lib/ui/FormField.svelte";
  import Checkbox from "../../lib/ui/Checkbox.svelte";
  import Button from "../../lib/ui/Button.svelte";
  let {
    item,
    type,
    readonly = false,
    onclose,
  }: {
    item: { id: string; replace?: boolean; file?: string };
    type: "instruction" | "skill";
    readonly?: boolean;
    onclose: () => void;
  } = $props();
</script>

<Modal
  label="Advanced settings"
  title="Advanced settings"
  {onclose}
  size="small"
>
  <FormField label="Reference name"
    >{#snippet children(id, describedby)}<Input
        {id}
        aria-describedby={describedby}
        bind:value={item.id}
        maxlength={64}
        disabled={readonly}
      />{/snippet}</FormField
  >
  {#if item.file !== undefined}<FormField
      label="File name"
      help="Existing reference, relative to this persona’s folder."
      >{#snippet children(id, describedby)}<Input
          {id}
          aria-describedby={describedby}
          bind:value={item.file}
          disabled={readonly}
        />{/snippet}</FormField
    >{/if}
  <Checkbox
    label={`Replace a matching ${type}`}
    checked={item.replace === true}
    disabled={readonly}
    onchange={(event) => {
      if (event.currentTarget.checked) item.replace = true;
      else delete item.replace;
    }}
  />
  {#snippet footer()}<Button onclick={onclose}>Done</Button>{/snippet}
</Modal>
