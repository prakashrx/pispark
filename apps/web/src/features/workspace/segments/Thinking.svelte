<script lang="ts">
  import SessionMarkdown from "../SessionMarkdown.svelte";
  import ThoughtCard from "../ThoughtCard.svelte";
  import type { Segment } from "../session-turns";

  let { segment }: { segment: Extract<Segment, { kind: "thinking" }> } = $props();
</script>

<ThoughtCard label={segment.streaming ? "Thinking…" : segment.label}><SessionMarkdown text={segment.text} streaming={segment.streaming} /></ThoughtCard>
