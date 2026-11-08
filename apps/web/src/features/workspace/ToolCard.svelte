<script lang="ts">
  let {
    name,
    result,
    content = "",
  }: { name: string; result: "requested" | "done" | "error"; content?: string } = $props();

  let expanded = $state(false);
  const hasContent = $derived(!!content?.trim());
  const label = $derived(
    result === "requested" ? "Requested" : result === "error" ? "Failed" : "Done",
  );
</script>

<div class="tool-row">
  <button
    type="button"
    class="tool-chip"
    data-result={result}
    onclick={() => { if (hasContent) expanded = !expanded; }}
    aria-expanded={hasContent ? expanded : undefined}
  >
    <svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.3-.6-.6-2.3 2.4-2.6Z" />
    </svg>
    <span class="tool-name">{name}</span>
    <span class="tool-status"><span class="tool-dot"></span>{label}</span>
    {#if hasContent}
      <svg class="tool-chevron" class:open={expanded} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
      </svg>
    {/if}
  </button>
  {#if expanded && hasContent}
    <div class="tool-output">{content}</div>
  {/if}
</div>

<style>
  .tool-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
  .tool-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem 0.375rem 0.625rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--background);
    font: inherit;
    font-size: 0.8125rem;
    color: var(--foreground);
    cursor: default;
    transition: background 0.12s, border-color 0.12s;
  }
  .tool-chip:where([aria-expanded]) {
    cursor: pointer;
  }
  .tool-chip:where([aria-expanded]):hover {
    background: var(--muted);
    border-color: var(--input);
  }
  .tool-icon {
    width: 0.95rem;
    height: 0.95rem;
    color: var(--muted-foreground);
  }
  .tool-name {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 500;
  }
  .tool-status {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.05rem 0.45rem;
    border-radius: var(--radius-full);
    font-size: 0.72rem;
    font-weight: 500;
  }
  .tool-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  [data-result="requested"] .tool-status {
    background: var(--warning-muted);
    color: var(--warning-foreground);
  }
  [data-result="done"] .tool-status {
    background: var(--success-muted);
    color: var(--success-foreground);
  }
  [data-result="error"] .tool-status {
    background: var(--danger-muted);
    color: var(--danger-foreground);
  }
  .tool-chevron {
    width: 0.9rem;
    height: 0.9rem;
    color: var(--subtle-foreground);
    transition: transform 0.15s;
  }
  .tool-chevron.open {
    transform: rotate(180deg);
  }
  .tool-output {
    align-self: stretch;
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--code-surface);
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    color: var(--foreground);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 16rem;
    overflow-y: auto;
    line-height: 1.6;
  }
</style>
