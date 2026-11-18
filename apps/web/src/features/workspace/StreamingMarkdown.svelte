<script lang="ts">
  import { markdownBlocks } from "../../lib/markdown";
  import { attention } from "../../shell/attention.svelte";

  /** A reply as Markdown. While it streams only its last block is re-rendered; the rest never change. */
  let { text, streaming = false }: { text: string; streaming?: boolean } = $props();
  const blocks = $derived(markdownBlocks(text, streaming));
  let root = $state<HTMLElement>();
  // Each code block gets a Copy button (C-20) once it is complete.
  $effect(() => {
    void blocks;
    if (!root) return;
    for (const pre of root.querySelectorAll("pre")) {
      if (pre.querySelector(".code-copy") || (streaming && pre === root.querySelector("pre:last-of-type"))) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "code-copy";
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy code");
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(pre.querySelector("code")?.textContent ?? pre.textContent ?? "");
          attention.say("Code copied");
        } catch {
          attention.say("Couldn’t copy the code");
        }
      });
      pre.append(button);
    }
  });
</script>

<div class="prose max-w-none" bind:this={root}>{#each blocks as html, index (index)}{@html html}{/each}</div>

<style>
  .prose :global(pre) {
    position: relative;
  }
  .prose :global(.code-copy) {
    position: absolute;
    top: 0.375rem;
    right: 0.375rem;
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--background);
    color: var(--muted-foreground);
    font-family: var(--font-sans, inherit);
    font-size: var(--text-xs);
    opacity: 0;
  }
  .prose :global(pre:hover .code-copy),
  .prose :global(.code-copy:focus-visible) {
    opacity: 1;
  }
  @media (hover: none) {
    .prose :global(.code-copy) {
      opacity: 1;
    }
  }
</style>
