<script lang="ts">
  import MessageReader from "../MessageReader.svelte";
  import StreamingMarkdown from "../StreamingMarkdown.svelte";
  import type { Segment } from "../chat-turns";

  let { segment }: { segment: Extract<Segment, { kind: "text" }> } = $props();
  // Text cut at its limit ends where the cut was, not mid-word as if it were whole.
  const text = $derived(segment.size !== undefined ? `${segment.text.trimEnd()}…` : segment.text);
</script>

<div class="segment">
  <StreamingMarkdown {text} streaming={segment.streaming} />
  {#if segment.detail}{#key segment.detail.id}<MessageReader reference={segment.detail} />{/key}{/if}
</div>

<style>
  .segment {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
</style>
