<script lang="ts">
  import type { StyledLine } from "../../../../server/src/contract/protocol";
  import StyledText from "./StyledText.svelte";

  /** An extension's working indicator: its frames, cycled at its interval (Pi's default 80ms). */
  let { frames, intervalMs = 80 }: { frames: StyledLine[]; intervalMs?: number } = $props();
  let index = $state(0);
  $effect(() => {
    if (frames.length < 2) return;
    // Respect reduced motion: show the first frame only.
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => (index = (index + 1) % frames.length), Math.max(50, intervalMs));
    return () => clearInterval(timer);
  });
</script>

{#if frames.length}<span class="working-frames" aria-hidden="true"><StyledText lines={[frames[index % frames.length]!]} /></span>{/if}

<style>
  .working-frames {
    display: inline-flex;
  }
  .working-frames :global(.styled-text) {
    font-size: 0.75rem;
    line-height: 1;
    color: currentColor;
  }
</style>
