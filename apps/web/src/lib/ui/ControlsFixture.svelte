<script lang="ts">
  import Input from "./Input.svelte";
  import Textarea from "./Textarea.svelte";
  import Button from "./Button.svelte";
  import FormField from "./FormField.svelte";
  import Checkbox from "./Checkbox.svelte";
  import Toggle from "./Toggle.svelte";
  import Tabs from "./Tabs.svelte";
  import Menu from "./Menu.svelte";
  import Modal from "./Modal.svelte";
  import FieldGroup from "./FieldGroup.svelte";
  import Disclosure from "./Disclosure.svelte";
  import Section from "./Section.svelte";
  import ContentDialog from "./ContentDialog.svelte";
  let contentOpen = $state(false);
  let contentValue = $state(
    "  Literal <b>literal markup</b>\n" +
      "Readable line of content.\n".repeat(120),
  );
  let name = $state("");
  let checked = $state(false);
  let switched = $state(false);
  let tab = $state("first");
  let open = $state(false);
  let action = $state("");
  let {
    busy = false,
    focusCases = false,
    contentCases = false,
  }: {
    busy?: boolean;
    focusCases?: boolean;
    contentCases?: boolean;
  } = $props();
</script>

{#if contentCases}
  <Section
    title="Split section"
    description="Readable help"
    layout="split"
    class="fixture-section"
  >
    <Button onclick={() => (contentOpen = true)}>Read content</Button>
  </Section>
  <Section
    title="Stacked section"
    description="Existing layout"
    class="existing-class"><p>Existing content</p></Section
  >
  <output aria-label="Applied text">{contentValue}</output>
  {#if contentOpen}
    <ContentDialog
      ownerKey="fixture"
      value={contentValue}
      permission="edit"
      maxBytes={65536}
      onapply={(text) => {
        contentValue = text;
        return true;
      }}
      onclose={() => (contentOpen = false)}
    />
  {/if}
{:else}
  <FormField label="Name" help="Visible help" error="Required name" required>
    {#snippet children(id, describedby)}<Input
        {id}
        aria-describedby={describedby}
        required
        invalid
        bind:value={name}
      />{/snippet}
  </FormField>
  <output aria-label="Draft name">{name}</output>
  <Textarea label="Description" readonly value="Read only" />
  <Checkbox label="Include" help="Checkbox help" bind:checked />
  <output aria-label="Included">{checked}</output>
  <Toggle label="Enabled" bind:checked={switched} />
  <output aria-label="Switched">{switched}</output>
  <Button variant="primary" size="compact" loading={busy}>Save</Button>
  <Tabs
    label="Editor"
    tabs={[
      { id: "first", label: "First" },
      { id: "disabled", label: "Disabled", disabled: true },
      { id: "last", label: "Last" },
    ]}
    bind:value={tab}
  >
    {#snippet children(id)}
      {#if id === "first"}<Input
          label="Retained draft"
        />{:else if id === "last"}<p>Last panel</p>{/if}
    {/snippet}
  </Tabs>
  <Menu
    label="Actions"
    items={[
      { id: "one", label: "First action", onselect: () => (action = "one") },
      {
        id: "no",
        label: "Unavailable action",
        disabled: true,
        onselect: () => (action = "no"),
      },
      { id: "two", label: "Last action", onselect: () => (action = "two") },
    ]}
  />
  <output aria-label="Action">{action}</output>
  <Button onclick={() => (open = true)}>Open dialog</Button>
  {#if open}<Modal
      label="Test dialog"
      title="Test dialog"
      help="Dialog help"
      initialFocus="#dialog-name"
      {busy}
      onclose={() => (open = false)}
    >
      <Input id="dialog-name" label="Dialog name" />
      {#snippet footer()}<Button onclick={() => (open = false)}>Done</Button>
        {#if focusCases}
          <details>
            <summary>Dialog details</summary>
            <textarea aria-label="Read-only detail" readonly
              >Saved text</textarea
            >
          </details>
          <button type="button" disabled>Disabled target</button>
          <fieldset disabled>
            <button type="button">Disabled by fieldset</button>
          </fieldset>
          <div hidden><button type="button">Hidden target</button></div>
          <button type="button" style="display: none"
            >Non-rendered target</button
          >
          <button type="button" tabindex="-1">Negative target</button>
          <details><summary tabindex="-1">Negative summary</summary></details>
        {/if}
      {/snippet}
    </Modal>{/if}
  <FieldGroup title="Resources" help="Group help"
    ><Disclosure title="Details"><p>Optional detail</p></Disclosure></FieldGroup
  >
{/if}
