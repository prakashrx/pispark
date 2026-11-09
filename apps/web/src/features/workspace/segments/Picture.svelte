<script lang="ts">
  import ArtifactImage from "../ArtifactImage.svelte";
  import type { Segment } from "../chat-turns";

  /** A picture a tool returned, or an SVG a tool wrote. */
  let { segment, sessionId }: { segment: Extract<Segment, { kind: "image" | "svg" }>; sessionId: string } = $props();
</script>

{#if segment.kind === "svg"}
  <ArtifactImage {sessionId} markup={segment.markup} alt={segment.alt} />
{:else}
  <ArtifactImage {sessionId} itemId={segment.itemId} part={segment.part} mimeType={segment.mimeType} alt={segment.alt} />
{/if}
