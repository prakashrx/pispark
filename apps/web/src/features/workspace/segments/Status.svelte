<script lang="ts">
  import Icon from "../../../lib/ui/Icon.svelte";
  import { useSessions } from "../session-client.svelte";
  import type { Segment } from "../session-turns";
  // Something this session started ended, said in one line without a turn. Its mark
  // follows whether it went as it should; a line that does not say (a watch, an older line) has none.
  let { segment }: { segment: Extract<Segment, { kind: "status" }> } = $props();
  const client = useSessions();
  const known = $derived(!!segment.session && client.sessions.some((s) => s.id === segment.session));
  const mark = $derived(segment.ok === true ? "check" : segment.ok === false ? "alert" : "info");
</script>

<p class="status-line" role="note" data-purpose="status-line">
  <Icon name={mark} class="h-3.5 w-3.5 shrink-0" />
  <span>
    {#if known}<button type="button" class="link" onclick={() => client.open(segment.session!)}>
        {segment.title}
      </button>{:else}{segment.title}{/if}
    {segment.how}
  </span>
</p>

<style>
  .status-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
  .link {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
