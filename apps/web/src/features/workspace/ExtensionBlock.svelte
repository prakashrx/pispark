<script lang="ts">
  import type { StyledLine } from "../../../../server/src/contract/protocol";
  import StyledText from "./StyledText.svelte";

  /** An extension's custom message or entry in the conversation, or a notice it raised. */
  let {
    lines,
    kind,
  }: { lines: StyledLine[]; kind?: "info" | "warning" | "error" } = $props();
  const label = $derived(kind === "error" ? "Error" : kind === "warning" ? "Warning" : undefined);
</script>

<div class="extension-block" data-kind={kind} role={kind === "error" ? "alert" : kind ? "status" : undefined}>
  {#if label}<span class="extension-label">{label}</span>{/if}
  <StyledText {lines} />
</div>

<style>
  .extension-block {
    display: flex;
    align-items: baseline;
    gap: 0.625rem;
    padding: 0.625rem 0.875rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--card);
  }
  /* Notices are lines in the conversation, as in terminal Pi; only warnings and errors get a tint. */
  .extension-block[data-kind] {
    padding: 0.125rem 0.875rem;
    border-color: transparent;
    background: transparent;
    color: var(--muted-foreground);
  }
  .extension-block[data-kind] :global(.styled-text) {
    color: var(--muted-foreground);
  }
  .extension-block[data-kind="warning"],
  .extension-block[data-kind="error"] {
    padding: 0.5rem 0.875rem;
  }
  .extension-block[data-kind="warning"] {
    background: var(--warning-muted);
  }
  .extension-block[data-kind="error"] {
    background: var(--danger-muted);
  }
  .extension-label {
    flex: none;
    font-size: 0.75rem;
    font-weight: 600;
  }
  [data-kind="warning"] .extension-label {
    color: var(--warning-foreground);
  }
  [data-kind="error"] .extension-label {
    color: var(--danger-foreground);
  }
</style>
