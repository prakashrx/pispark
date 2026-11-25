<script lang="ts">
  /**
   * Under text that isn't this agent's to change (inherited, bundled): where it comes from, and the
   * one way to change it, making it this agent's own copy. Shows nothing for its own text.
   */
  import Icon from "../../lib/ui/Icon.svelte";
  import { isFresh, type AgentPage, type Row } from "./agent-page.svelte";

  let { page, item }: { page: AgentPage; item: Row } = $props();
  const from = $derived(isFresh(item) ? "" : item.origin.id !== page.agent ? item.origin.name : "PiSpark");
</script>

{#if !isFresh(item) && !page.editable(item)}
  <p class="locked">
    <Icon name="lock" class="h-3 w-3" />Comes from {from}.
    {#if !page.readOnly}
      <button type="button" class="link" disabled={page.client.busy} onclick={() => void page.makeOwn(item)}>Make it {page.here}'s own</button> to change it.
    {/if}
  </p>
{/if}

<style>
  .locked {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .link {
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
