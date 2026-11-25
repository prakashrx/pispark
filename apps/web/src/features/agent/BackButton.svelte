<script lang="ts">
  /**
   * Back to where you came from, named after it ("Skills", "Back to Shop developer"). One look for
   * every way back on this page: a tab's list on a phone, an extension's page.
   */
  import Icon from "../../lib/ui/Icon.svelte";

  let { label, onclick, ref = $bindable() }: { label: string; onclick: () => void; ref?: HTMLButtonElement } = $props();
</script>

<button bind:this={ref} type="button" class="back" {onclick}><Icon name="back" class="h-4 w-4" />{label}</button>

<style>
  .back {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 2.25rem;
    margin-left: -0.375rem;
    padding: 0 0.5rem 0 0.25rem;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .back:hover {
    background: var(--muted);
    color: var(--foreground);
  }
</style>
