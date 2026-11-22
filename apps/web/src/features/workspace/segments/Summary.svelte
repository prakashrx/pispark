<script lang="ts">
  import SessionMarkdown from "../SessionMarkdown.svelte";
  import ThoughtCard from "../ThoughtCard.svelte";
  import type { Segment } from "../session-turns";

  let { segment }: { segment: Extract<Segment, { kind: "summary" }> } = $props();
</script>

<ThoughtCard label="Earlier messages were summarized"><SessionMarkdown text={segment.text} /></ThoughtCard>
