<script lang="ts">
  import type { StyledLine } from "../../../../server/src/contract/protocol";
  import Icon from "../../lib/ui/Icon.svelte";
  import StyledText from "./StyledText.svelte";

  /** An extension's custom message or entry in the conversation, or a notice it raised. */
  let {
    lines,
    kind,
  }: { lines: StyledLine[]; kind?: "info" | "warning" | "error" } = $props();
  const label = $derived(kind === "error" ? "Error" : kind === "warning" ? "Warning" : undefined);
  // The line the session keeps when a question was answered ("Delete it? — you said yes"): the
  // question, then what was said, with a mark for it.
  const receipt = $derived.by(() => {
    if (kind !== "info" || lines.length !== 1) return undefined;
    const text = lines[0]!.map((span) => span.text).join("");
    const match = /^(.*\S)\s+—\s+(you said yes|you said no|you chose .+|skipped|answered)$/.exec(text);
    if (!match) return undefined;
    const said = match[2]!;
    return { asked: match[1]!, said, mark: said === "you said yes" ? "check" : said === "you said no" ? "close" : said === "skipped" ? "info" : "check" } as const;
  });
</script>

{#if receipt}
  <div class="receipt" role="status">
    <Icon name={receipt.mark} class="h-3.5 w-3.5 shrink-0" />
    <span class="asked">{receipt.asked}</span>
    <span class="said">{receipt.said}</span>
  </div>
{:else}
  <div class="extension-block" data-kind={kind} role={kind === "error" ? "alert" : kind ? "status" : undefined}>
    {#if label}<span class="extension-label">{label}</span>{/if}
    <StyledText {lines} prose={!!kind} />
  </div>
{/if}

<style>
  .receipt {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 1.75rem;
    padding: 0 0.125rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .asked {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .said {
    flex-shrink: 0;
    padding: 0 0.5rem;
    border-radius: var(--radius-full);
    background: var(--muted);
    font-size: var(--text-xs);
    line-height: 1.25rem;
    color: var(--foreground);
  }
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
