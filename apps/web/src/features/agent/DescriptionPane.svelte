<script lang="ts">
  /**
   * A resource's description, edited in place with a pencil: a skill's "Use when" (what the agent
   * decides from) or a prompt's "What it's for" (what the slash picker shows). It is the
   * `description` in the file's front matter, so the change waits for the save bar like the text.
   */
  import { tick } from "svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Pane from "./Pane.svelte";
  import { fieldOf, withField } from "./frontmatter";
  import { isFresh, type AgentPage, type Row } from "./agent-page.svelte";

  let {
    page,
    item,
    title,
    empty,
    note,
    area,
  }: {
    page: AgentPage;
    item: Row;
    title: string;
    /** Said when there's none yet. */
    empty: string;
    note?: string;
    area?: string;
  } = $props();

  const id = $props.id();
  const text = $derived(page.text(item));
  const value = $derived(text ? fieldOf(page.draft(item), "description") : isFresh(item) ? "" : (item.description ?? ""));
  const can = $derived(page.editable(item) && !!text && !text.loading && !text.error);
  let editing = $state(false);
  let draft = $state("");
  let pencil: HTMLButtonElement | undefined = $state();
  let field: HTMLTextAreaElement | undefined = $state();

  async function edit() {
    draft = value;
    editing = true;
    await tick();
    field?.focus();
  }
  async function done(keep: boolean) {
    if (!editing) return;
    const next = draft.trim().replace(/\s+/g, " ");
    if (keep && next !== value) page.setDraft(item, withField(page.draft(item), "description", next));
    editing = false;
    await tick();
    pencil?.focus();
  }
</script>

<Pane {title} {area}>
  {#snippet action()}
    {#if can && !editing}
      <button bind:this={pencil} type="button" class="ui-button" data-size="icon" aria-label={`Edit ${title.toLowerCase()}`} title="Edit" onclick={() => void edit()}><Icon name="pencil" class="h-3.5 w-3.5" /></button>
    {/if}
  {/snippet}
  <div class="box">
    {#if editing}
      <textarea
        id={`${id}-field`}
        bind:this={field}
        bind:value={draft}
        aria-label={title}
        onblur={() => void done(true)}
        onkeydown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            void done(false);
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void done(true);
          }
        }}
      ></textarea>
    {:else}
      <p class="value" class:empty={!value}>{value || empty}</p>
    {/if}
  </div>
  {#if note}<p class="note">{note}</p>{/if}
</Pane>

<style>
  .box {
    padding: 0.75rem 0.875rem;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--muted) 45%, transparent);
  }
  .value {
    font-family: var(--font-reading);
    font-size: var(--text-sm);
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  .value.empty {
    color: var(--subtle-foreground);
  }
  textarea {
    width: 100%;
    min-height: 4.5rem;
    field-sizing: content;
    resize: none;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--ring);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    line-height: 1.5;
    background: var(--background);
  }
  textarea:focus {
    outline: none;
  }
  .note {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
