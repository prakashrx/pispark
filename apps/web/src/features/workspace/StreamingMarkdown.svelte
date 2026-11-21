<script lang="ts">
  import { markdownBlocks } from "../../lib/markdown";
  import { sessionImageUrl } from "../files/file-kinds";
  import { attention } from "../../shell/attention.svelte";

  /** A reply as Markdown. While it streams only its last block is re-rendered; the rest never change. */
  let { text, streaming = false, sessionId }: { text: string; streaming?: boolean; sessionId?: string } = $props();
  const blocks = $derived(markdownBlocks(text, streaming, sessionId
    ? { scope: sessionId, source: (href) => sessionImageUrl(sessionId!, href) }
    : undefined));

  let root = $state<HTMLElement>();
  // Each code block gets a Copy button (C-20) once it is complete.
  $effect(() => {
    void blocks;
    if (!root) return;
    const code = [...root.querySelectorAll("pre")];
    for (const pre of code) {
      if (pre.querySelector(".code-copy") || (streaming && pre === code.at(-1))) continue;
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

<div class="prose max-w-none" bind:this={root}>{#each blocks as html, index (index)}
  {#if html.startsWith("<table>")}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users can scroll wide tables.) -->
    <div class="table-scroll" role="region" aria-label="Table" tabindex="0">{@html html}</div>
  {:else}
    <div class="reading-block">{@html html}</div>
  {/if}
{/each}</div>

<style>
  .reading-block {
    max-width: var(--conversation-reading-width);
    display: flow-root;
  }
  .prose :global(img) {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-md);
  }
  .table-scroll {
    overflow-x: auto;
    overflow-wrap: normal;
  }
  .table-scroll:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
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
