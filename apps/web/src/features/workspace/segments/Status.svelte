<script lang="ts">
  import Icon from "../../../lib/ui/Icon.svelte";
  import { useSessions } from "../session-client.svelte";
  import type { Segment } from "../chat-turns";
  // Something this session started ended, said in one line without a turn (status mode).
  let { segment }: { segment: Extract<Segment, { kind: "status" }> } = $props();
  const client = useSessions();
  const known = $derived(!!segment.session && client.sessions.some((s) => s.id === segment.session));
  const failed = $derived(/fail|exited [1-9]|stopped/.test(segment.how));
</script>

<p class="status-line" role="note" data-purpose="status-line">
  <Icon name={failed ? "alert" : "check"} class="h-3.5 w-3.5 shrink-0" />
  <span
    >{#if known}<button type="button" class="link" onclick={() => client.select(segment.session!)}>{segment.title}</button
      >{:else}{segment.title}{/if}
    {segment.how}</span
  >
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
