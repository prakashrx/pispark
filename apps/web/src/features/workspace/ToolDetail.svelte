<script lang="ts">
  import StyledText from "./StyledText.svelte";
  import type { ToolCall } from "./chat-turns";

  /** What a call did, once opened: its extension's own rendering, else what it returned, else what it was asked. */
  let { call }: { call: ToolCall } = $props();
  const result = $derived(
    call.result?.parts
      .map((part) => (part.type === "text" ? part.text : part.type === "image" ? `[${part.mimeType} image]` : ""))
      .filter(Boolean)
      .join("\n") ?? "",
  );
</script>

<div class="call-detail">
  {#if call.result?.rendered}
    {#if call.result.rendered.call}<StyledText lines={call.result.rendered.call} />{/if}
    {#if call.result.rendered.body}<StyledText lines={call.result.rendered.body} />{/if}
  {:else if result}<pre class="call-output">{result}</pre>
  {:else}<pre class="call-output">{JSON.stringify(call.args, null, 2)}</pre>{/if}
</div>

<style>
  .call-detail {
    margin: 0.25rem 0 0.5rem;
  }
  .call-output {
    margin: 0;
    padding: 0.625rem 0.875rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--code-surface);
    font-family: var(--font-mono);
    font-variant-ligatures: none;
    font-size: 0.8125rem;
    line-height: 1.6;
    color: var(--foreground);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 16rem;
    overflow-y: auto;
  }
</style>
