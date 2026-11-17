<script lang="ts" module>
  /** What a mark says, by meaning; features map their own states onto these. */
  export type StatusKind = "attention" | "error" | "busy" | "waiting" | "fresh";
</script>

<script lang="ts">
  /**
   * One small mark for a state, by shape and words, never by colour alone: a filled "?" for
   * something that needs you, "!" for an error, a spinner while busy, a clock while waiting, a dot
   * for something new. Words show beside it or stay for screen readers.
   */
  let {
    kind,
    label,
    words = false,
    detail,
  }: { kind: StatusKind; label: string; words?: boolean; detail?: string } = $props();
</script>

<span class="status-mark" data-kind={kind} title={label}>
  {#if kind === "busy"}<span class="spin" aria-hidden="true"></span>
  {:else if kind === "fresh"}<span class="dot" aria-hidden="true"></span>
  {:else if kind === "waiting"}<svg class="glyph clock" viewBox="0 0 20 20" aria-hidden="true"
      ><circle cx="10" cy="10" r="7.25" /><path d="M10 6v4l2.5 1.5" /></svg
    >
  {:else}<span class="glyph round" aria-hidden="true">{kind === "attention" ? "?" : "!"}</span>{/if}
  {#if words}<span class="word">{label}{#if detail}<span class="detail">{` ${detail}`}</span>{/if}</span>
  {:else}<span class="sr-only">{label}{detail ? ` ${detail}` : ""}</span>{/if}
</span>

<style>
  .status-mark {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .glyph {
    width: 1.125rem;
    height: 1.125rem;
  }
  .round {
    display: inline-grid;
    place-items: center;
    border-radius: var(--radius-full);
    border: 1.5px solid currentColor;
    font-size: var(--text-2xs);
    font-weight: 800;
    line-height: 1;
  }
  .clock {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  /* Needs you is the strongest mark: filled, in the accent. */
  [data-kind="attention"] {
    color: var(--interactive-text);
  }
  [data-kind="attention"] .round {
    background: var(--interactive);
    border-color: var(--interactive);
    color: var(--interactive-foreground);
  }
  [data-kind="attention"] .word {
    font-weight: 700;
  }
  [data-kind="error"] {
    color: var(--danger-foreground);
  }
  .spin {
    width: 0.875rem;
    height: 0.875rem;
    margin: 0.125rem;
    border-radius: var(--radius-full);
    border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
    border-top-color: var(--interactive);
    animation: status-spin 0.9s linear infinite;
  }
  .dot {
    width: 0.5rem;
    height: 0.5rem;
    margin: 0.3125rem;
    border-radius: var(--radius-full);
    background: var(--interactive);
  }
  .detail {
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }
  @keyframes status-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
      border-color: currentColor;
      border-style: dotted;
    }
  }
</style>
