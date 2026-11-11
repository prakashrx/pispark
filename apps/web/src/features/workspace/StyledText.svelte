<script lang="ts">
  import type { StyledLine, StyledSpan } from "../../../../server/src/contract/protocol";

  /** Text an extension wrote for a terminal, drawn with this theme's colors. */
  let { lines, class: className = "" }: { lines: StyledLine[]; class?: string } = $props();

  const role = (value: string | undefined, slot: "fg" | "bg") =>
    value && !value.startsWith("#") ? `${slot}-${value}` : "";
  const classes = (span: StyledSpan) =>
    [
      role(span.fg, "fg"),
      role(span.bg, "bg"),
      span.bold && "bold",
      span.dim && "dim",
      span.italic && "italic",
      span.underline && "underline",
      span.strike && "strike",
    ]
      .filter(Boolean)
      .join(" ");
  const style = (span: StyledSpan) =>
    [
      span.fg?.startsWith("#") && `color: ${span.fg}`,
      span.bg?.startsWith("#") && `background: ${span.bg}`,
    ]
      .filter(Boolean)
      .join("; ") || undefined;
</script>

<div class="styled-text {className}">
  {#each lines as line}
    <div class="line">
      {#each line as span}
        {#if span.link}<a href={span.link} target="_blank" rel="noopener noreferrer" class={classes(span)} style={style(span)}>{span.text}</a>
        {:else}<span class={classes(span)} style={style(span)}>{span.text}</span>{/if}
      {:else}&#8203;{/each}
    </div>
  {/each}
</div>

<style>
  .styled-text {
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    line-height: 1.55;
    color: var(--foreground);
    min-width: 0;
  }
  .line {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .fg-accent { color: var(--interactive-text); }
  .fg-success { color: var(--success-foreground); }
  .fg-warning { color: var(--warning-foreground); }
  .fg-danger { color: var(--danger-foreground); }
  .fg-muted { color: var(--muted-foreground); }
  .fg-subtle { color: var(--subtle-foreground); }
  .fg-border { color: var(--input); }
  .fg-selected { color: var(--foreground); }
  .bg-selected { background: var(--control-selected); }
  .bg-accent { background: var(--interactive-muted); }
  .bg-success { background: var(--success-muted); }
  .bg-warning { background: var(--warning-muted); }
  .bg-danger { background: var(--danger-muted); }
  .bg-muted,
  .bg-subtle,
  .bg-border { background: var(--muted); }
  .bold { font-weight: 600; }
  .dim { opacity: 0.72; }
  .italic { font-style: italic; }
  .underline { text-decoration: underline; }
  .strike { text-decoration: line-through; }
  a {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
