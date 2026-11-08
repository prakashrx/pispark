<script lang="ts">
  import InlinePanel from "../../lib/ui/InlinePanel.svelte";
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

<InlinePanel
  label="Advanced settings"
  title="Advanced settings"
  help={`How this ${type === "instruction" ? "prompt" : "skill"} is identified when personas reuse or replace each other’s resources.`}
  variant="editor"
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
    label={`Replace an inherited ${type === "instruction" ? "prompt" : "skill"} with the same reference name`}
    checked={item.replace === true}
    disabled={readonly}
    onchange={(event) => {
      if (event.currentTarget.checked) item.replace = true;
      else delete item.replace;
    }}
  />
  {#snippet footer()}<Button onclick={onclose}>Done</Button>{/snippet}
</InlinePanel>
