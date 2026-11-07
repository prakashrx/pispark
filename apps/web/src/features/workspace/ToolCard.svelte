<script lang="ts">
  let {
    name,
    result,
    content = "",
  }: { name: string; result: "running" | "done" | "error"; content?: string } = $props();

  let expanded = $state(false);
  const hasContent = $derived(!!content?.trim());
</script>

<div class="tool-row">
  <button
    type="button"
    class="tool-chip"
    onclick={() => { if (hasContent) expanded = !expanded; }}
    aria-expanded={hasContent ? expanded : undefined}
  >
    <span class="tool-dot" class:running={result === "running"} class:done={result === "done"} class:error={result === "error"}></span>
    <span class="tool-name">{name}</span>
    {#if hasContent}<span class="tool-toggle">{expanded ? "▴" : "▾"}</span>{/if}
  </button>
  {#if expanded && hasContent}
    <div class="tool-output">{content}</div>
  {/if}
</div>

<style>
  .tool-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .tool-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    background: none;
    border: none;
    font: inherit;
    cursor: default;
  }
  .tool-chip:where([aria-expanded]) {
    cursor: pointer;
  }
  .tool-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .tool-dot.running {
    background: var(--warning);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .tool-dot.done {
    background: var(--success);
  }
  .tool-dot.error {
    background: var(--danger);
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .tool-name {
    font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
    font-size: 11px;
    color: var(--muted-foreground);
  }
  .tool-toggle {
    font-size: 10px;
    color: var(--muted-foreground);
    opacity: 0.6;
  }
  .tool-output {
    margin-left: 1.25rem;
    padding: 0.5rem 0.75rem;
    border-left: 2px solid var(--border);
    font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
    font-size: 11px;
    color: var(--muted-foreground);
    white-space: pre-wrap;
    word-break: break-words;
    max-height: 10rem;
    overflow-y: auto;
    line-height: 1.6;
  }
</style>
