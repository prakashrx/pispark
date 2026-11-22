<script lang="ts">
  import { untrack } from "svelte";
  import { MarkdownView, type MarkdownOptions } from "./view";

  /** Markdown, finished or still `streaming`. Options are read once, when it is first drawn. */
  let { text, streaming = false, options = {} }: { text: string; streaming?: boolean; options?: MarkdownOptions } = $props();

  let root = $state<HTMLElement>();
  let view = $state.raw<MarkdownView>();
  $effect(() => {
    if (!root) return;
    const shown = new MarkdownView(root, untrack(() => options));
    view = shown;
    return () => shown.destroy();
  });
  $effect(() => view?.update(text, streaming));
</script>

<div class="prose max-w-none markdown" bind:this={root}></div>
