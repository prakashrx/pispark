<script lang="ts">
  import { onMount, untrack, type Snippet } from "svelte";
  import Button from "../../lib/ui/Button.svelte";

  /**
   * What every question shares, whatever it asks: focus moves in and comes back, Escape skips, a
   * waiting question counts down, and key hints say what the keys do. A question's own view only
   * fills the body and answers; keeping this here is what makes any view behave the same way.
   */
  let {
    title,
    expiresAt,
    hint,
    onskip,
    children,
  }: { title: string; expiresAt?: number; hint: string; onskip: () => void; children: Snippet } = $props();

  const titleId = $props.id();
  let section = $state<HTMLElement>();
  let now = $state(Date.now());
  // The countdown bar needs how long the question waits in all, taken when it appears.
  const total = untrack(() => (expiresAt ? Math.max(1, expiresAt - Date.now()) : 0));
  $effect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const seconds = $derived(expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : undefined);

  // The run waits on this answer, so the question takes focus; focus goes back where it was after.
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    section?.scrollIntoView({ block: "nearest" });
    (section?.querySelector<HTMLElement>("[data-autofocus]") ?? section)?.focus({ preventScroll: true });
    return () => {
      const current = document.activeElement;
      if (!current || current === document.body || section?.contains(current)) previous?.focus();
    };
  });
  function keydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onskip();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section bind:this={section} class="prompt" role="group" aria-labelledby={titleId} tabindex="-1" onkeydown={keydown}>
  <div class="prompt-head">
    <div class="prompt-text">
      <p class="prompt-label">Needs your answer</p>
      <p id={titleId} class="prompt-title">{title}</p>
    </div>
    {#if seconds !== undefined}<span class="prompt-timer" aria-label={`${seconds} seconds left`}>{seconds}s</span>{/if}
    <Button variant="ghost" size="compact" onclick={onskip}>Skip</Button>
  </div>
  {@render children()}
  <p class="prompt-hint">{hint}</p>
  {#if total}<div class="prompt-bar" style:animation-duration={`${total}ms`} aria-hidden="true"></div>{/if}
</section>

<style>
  .prompt {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.875rem 1.125rem 1rem;
    border: 1px solid color-mix(in srgb, var(--interactive) 45%, var(--border));
    border-radius: var(--radius-lg);
    background: var(--card);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }
  .prompt:focus {
    outline: none;
  }
  .prompt-head {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }
  .prompt-text {
    flex: 1;
    min-width: 0;
  }
  .prompt-label {
    margin: 0 0 0.125rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--interactive-text);
  }
  .prompt-title {
    margin: 0;
    font-weight: 500;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .prompt-timer {
    padding-top: 0.25rem;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .prompt-hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--subtle-foreground);
  }
  .prompt-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: var(--interactive);
    transform-origin: left;
    animation: prompt-shrink linear forwards;
  }
  @keyframes prompt-shrink {
    to {
      transform: scaleX(0);
    }
  }
</style>
