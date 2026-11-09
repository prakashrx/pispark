<script lang="ts">
  /**
   * A picture in the message. Always drawn as an image, never as markup, so scripts and external
   * loads in an SVG do not run. A picture a tool returned is read by reference once its result is
   * saved; SVG markup a tool wrote comes from the tool's arguments.
   */
  let {
    sessionId,
    itemId,
    part,
    markup,
    mimeType,
    alt,
  }: { sessionId: string; itemId?: string; part?: number; markup?: string; mimeType?: string; alt: string } = $props();
  const source = $derived(
    markup !== undefined
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
      : itemId !== undefined
        ? `/api/sessions/${sessionId}/items/${itemId}/parts/${part}`
        : undefined,
  );
  let failed = $state(false);
</script>

{#if source && !failed}
  <a class="artifact" href={source} target="_blank" rel="noopener noreferrer" aria-label={`${alt} (opens full size)`}>
    <img src={source} {alt} loading="lazy" decoding="async" onerror={() => (failed = true)} />
  </a>
{:else}
  <p class="artifact-note">{failed ? `Couldn’t load ${alt}.` : `${alt} (${mimeType ?? "image"}) will appear once it is saved.`}</p>
{/if}

<style>
  .artifact {
    align-self: flex-start;
    max-width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    overflow: hidden;
    line-height: 0;
  }
  img {
    display: block;
    max-width: 100%;
    max-height: 24rem;
    object-fit: contain;
  }
  .artifact-note {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
</style>
