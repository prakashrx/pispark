<script lang="ts">
  /**
   * An item's text in the shared Markdown editor: loading and errors said in place, editable when
   * it's the agent's (or a shared one it may save), read-only with the way to make it its own
   * otherwise. A new item opens in Edit. One block for instructions, SKILL.md and prompt templates.
   */
  import { MarkdownEditor } from "../../lib/markdown";
  import LockedNote from "./LockedNote.svelte";
  import { isFresh, keyOf, type AgentPage, type Row } from "./agent-page.svelte";

  let {
    page,
    item,
    label,
    placeholder,
    frontmatter = "shown",
  }: {
    page: AgentPage;
    item: Row;
    label: string;
    placeholder: string;
    frontmatter?: "shown" | "hidden";
  } = $props();
  const text = $derived(page.text(item));
</script>

{#if text?.loading}<p class="note" role="status">Loading…</p>
{:else if text?.error}<p class="note" role="alert">{text.error}</p>
{:else}
  {#key keyOf(item)}
    <MarkdownEditor
      value={page.draft(item)}
      onchange={(next) => page.setDraft(item, next)}
      {label}
      editable={page.editable(item)}
      mode={isFresh(item) ? "edit" : "preview"}
      {frontmatter}
      {placeholder}
    />
  {/key}
{/if}
<LockedNote {page} {item} />

<style>
  .note {
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
</style>
