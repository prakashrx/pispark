<script lang="ts">
  import ThoughtCard from "../ThoughtCard.svelte";
  import type { Segment } from "../chat-turns";

  let { segment }: { segment: Extract<Segment, { kind: "thinking" }> } = $props();
</script>

<ThoughtCard label={segment.streaming ? "Thinking…" : segment.label}>{segment.text}</ThoughtCard>
