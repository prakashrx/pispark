<script lang="ts">
  import Icon from "../../lib/ui/Icon.svelte";
  /** Your message, or (`woken`) one something else sent, such as a schedule, labelled as such. */
  let { text, woken }: { text: string; woken?: string } = $props();
</script>

<div class="flex flex-col items-end gap-1.5" data-purpose="user-turn">
  {#if woken}<p class="woken"><Icon name="clock" class="h-3.5 w-3.5" /><span>{woken}</span></p>{/if}
  <div class="user-bubble">
    {text}
  </div>
</div>

<style>
  .user-bubble {
    max-width: min(36rem, 80%);
    padding: 0.625rem 1.125rem;
    background: var(--bubble);
    color: var(--foreground);
    border-radius: var(--radius-xl);
    font-family: var(--font-reading);
    font-size: 1rem;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .woken {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
</style>
