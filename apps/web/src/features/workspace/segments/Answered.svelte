<script lang="ts">
  import Icon from "../../../lib/ui/Icon.svelte";
  import type { Segment } from "../session-turns";

  /** A question an extension asked, where it was asked: the question, then what was said, with a mark for it. */
  let { segment }: { segment: Extract<Segment, { kind: "answered" }> } = $props();
  const answered = $derived(segment.answered);
  // The answer itself: yes, no, the option chosen; a typed answer only that it was answered.
  const said = $derived(answered.said === "chose" ? (answered.choice ?? "chosen") : answered.said);
  const mark = $derived(answered.said === "no" ? "close" : answered.said === "skipped" ? "info" : "check");
</script>

<div class="answered" role="status">
  <Icon name={mark} class="h-3.5 w-3.5 shrink-0" />
  <span class="question">{answered.question}</span>
  <span class="said">{said}</span>
</div>

<style>
  .answered {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 1.75rem;
    padding: 0 0.125rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .question {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .said {
    flex-shrink: 0;
    max-width: 50%;
    overflow-wrap: anywhere;
    padding: 0 0.5rem;
    border-radius: var(--radius-full);
    background: var(--muted);
    font-size: var(--text-xs);
    line-height: 1.25rem;
    color: var(--foreground);
  }
</style>
