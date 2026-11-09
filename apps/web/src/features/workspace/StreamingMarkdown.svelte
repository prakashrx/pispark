<script lang="ts">
  import { markdownBlocks } from "../../lib/markdown";

  /** A reply as Markdown. While it streams only its last block is re-rendered; the rest never change. */
  let { text, streaming = false }: { text: string; streaming?: boolean } = $props();
  const blocks = $derived(markdownBlocks(text, streaming));
</script>

<div class="prose max-w-none">{#each blocks as html, index (index)}{@html html}{/each}</div>
