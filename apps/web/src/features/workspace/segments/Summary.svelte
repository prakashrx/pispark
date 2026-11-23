<script lang="ts">
  import SessionMarkdown from "../SessionMarkdown.svelte";
  import ThoughtCard from "../ThoughtCard.svelte";
  import { tokensShort } from "../session-presentation";
  import type { Segment } from "../session-turns";

  /**
   * Earlier messages were summarized: between your messages, or because the context nearly filled
   * in the middle of the work. Says how much the context held before; opens to the summary.
   */
  let { segment }: { segment: Extract<Segment, { kind: "summary" }> } = $props();
  const label = $derived(
    `${segment.between ? "Earlier messages were summarized" : "Context nearly full, earlier messages were summarized"}${segment.tokensBefore ? ` · ${tokensShort(segment.tokensBefore)} tokens before` : ""}`,
  );
</script>

<ThoughtCard {label}><SessionMarkdown text={segment.text} /></ThoughtCard>
