<script lang="ts">
  /** A made-up extension view for tests: a segment of kind `charts:bar`. */
  let { segment }: { segment: { key: string; values?: number[] } } = $props();
</script>

<figure aria-label="Bars">{(segment.values ?? []).join(",")}</figure>
