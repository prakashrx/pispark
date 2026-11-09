<script lang="ts">
  import { parsePatch } from "../../lib/diff";

  /** The changes to one file, as numbered lines; the message itself is where they are read. */
  let { patch, path, clipped = false }: { patch: string; path?: string; clipped?: boolean } = $props();
  const diff = $derived(parsePatch(patch));
  const name = $derived(path ?? diff.path ?? "file");
  let open = $state(true);
  // A very large change shows its start; the rest is one click away, not thousands of rows at once.
  const CAP = 400;
  let all = $state(false);
  const rows = $derived(diff.hunks.reduce((sum, hunk) => sum + hunk.rows.length, 0));
  const shown = $derived.by(() => {
    if (all || rows <= CAP) return diff.hunks;
    let left = CAP;
    return diff.hunks
      .map((hunk) => {
        const kept = hunk.rows.slice(0, Math.max(0, left));
        left -= kept.length;
        return { ...hunk, rows: kept };
      })
      .filter((hunk) => hunk.rows.length);
  });
  const regionId = $props.id();
</script>

<figure class="diff" aria-label={`Changes to ${name}`}>
  <button type="button" class="diff-head" aria-expanded={open} aria-controls={regionId} onclick={() => (open = !open)}>
    <span class="diff-name">{name}</span>
    <span class="diff-count add" aria-label={`${diff.added} lines added`}>+{diff.added}</span>
    <span class="diff-count del" aria-label={`${diff.removed} lines removed`}>−{diff.removed}</span>
    <svg class="diff-chevron" class:open viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  </button>
  {#if open}
    <!-- Long diffs scroll inside the card, so the card takes the keyboard to be scrollable by it. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div id={regionId} class="diff-body" role="region" aria-label={`Lines changed in ${name}`} tabindex="0">
      {#each shown as hunk, index}
        {#if index > 0}<div class="gap" aria-hidden="true">⋯</div>{/if}
        {#each hunk.rows as row}
          <div class="row" data-kind={row.kind}>
            <span class="num" aria-hidden="true">{row.old ?? ""}</span>
            <span class="num" aria-hidden="true">{row.new ?? ""}</span>
            <span class="sign" aria-label={row.kind === "add" ? "added" : row.kind === "del" ? "removed" : undefined}>{row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}</span>
            <span class="code">{row.text}</span>
          </div>
        {/each}
      {/each}
      {#if !diff.hunks.length}<div class="gap">No line changes to show.</div>{/if}
      {#if rows > CAP && !all}<button type="button" class="more" onclick={() => (all = true)}>Show all {rows} lines</button>{/if}
      {#if clipped}<div class="gap" role="note">This change was too large to send whole; showing its first part.</div>{/if}
    </div>
  {/if}
</figure>

<style>
  .diff {
    margin: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--code-surface);
    overflow: hidden;
    min-width: 0;
  }
  .diff-head {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.5rem 0.875rem;
    border: none;
    background: none;
    font: inherit;
    font-size: 0.8125rem;
    color: var(--foreground);
    cursor: pointer;
    text-align: left;
  }
  .diff-head:hover {
    background: var(--muted);
  }
  .diff-name {
    font-family: var(--font-mono);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .diff-count {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .add {
    color: var(--success-foreground);
  }
  .del {
    color: var(--danger-foreground);
  }
  .diff-chevron {
    margin-left: auto;
    width: 0.85rem;
    height: 0.85rem;
    flex: none;
    color: var(--subtle-foreground);
    transition: transform 0.15s;
  }
  .diff-chevron.open {
    transform: rotate(180deg);
  }
  .diff-body {
    border-top: 1px solid var(--border);
    max-height: 24rem;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    line-height: 1.55;
    /* Code reads as written: === stays three characters. */
    font-variant-ligatures: none;
  }
  .row {
    display: grid;
    grid-template-columns: 3rem 3rem 1.25rem 1fr;
    min-width: max-content;
    width: 100%;
  }
  .num {
    padding: 0 0.5rem;
    text-align: right;
    color: var(--subtle-foreground);
    user-select: none;
  }
  .sign {
    text-align: center;
    user-select: none;
  }
  .code {
    padding-right: 1rem;
    white-space: pre;
  }
  [data-kind="add"] {
    background: var(--success-muted);
  }
  [data-kind="add"] .sign {
    color: var(--success-foreground);
  }
  [data-kind="del"] {
    background: var(--danger-muted);
  }
  [data-kind="del"] .sign {
    color: var(--danger-foreground);
  }
  .more {
    display: block;
    width: 100%;
    padding: 0.375rem 0.875rem;
    border: none;
    border-top: 1px solid var(--border);
    background: var(--muted);
    font: inherit;
    font-family: var(--font-sans);
    font-size: 0.8125rem;
    color: var(--interactive-text);
    text-align: left;
    cursor: pointer;
  }
  .gap {
    padding: 0.125rem 0.875rem;
    color: var(--subtle-foreground);
    background: var(--muted);
    font-size: 0.75rem;
  }
</style>
