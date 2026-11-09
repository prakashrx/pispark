<script lang="ts">
  import ThoughtCard from "../ThoughtCard.svelte";
  import type { Segment } from "../chat-turns";

  let { segment }: { segment: Extract<Segment, { kind: "summary" }> } = $props();
</script>

<ThoughtCard label="Earlier messages were summarized">{segment.text}</ThoughtCard>
