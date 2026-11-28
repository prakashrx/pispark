<script lang="ts">
  import { onMount, untrack, type Snippet } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import { useNow } from "../../lib/clock.svelte";

  /**
   * What every question shares, whatever it asks: focus moves in and comes back, Escape skips, a
   * waiting question counts down, and key hints say what the keys do. A question's own view only
   * fills the body and answers; keeping this here is what makes any view behave the same way.
   * It reads as part of the conversation: small, in the conversation's column. Every question looks
   * the same: Pi's questions do not say how much care they ask for, and their own words say it.
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
  const clock = useNow(() => !!expiresAt);
  // The countdown bar needs how long the question waits in all, taken when it appears.
  const total = untrack(() => (expiresAt ? Math.max(1, expiresAt - Date.now()) : 0));
  const seconds = $derived(expiresAt ? Math.max(0, Math.ceil((expiresAt - clock.now) / 1000)) : undefined);

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
    <span class="prompt-mark" aria-hidden="true">?</span>
    <p class="prompt-label">Needs you</p>
    {#if seconds !== undefined}<span class="prompt-timer" aria-label={`${seconds} seconds left`}>{seconds}s</span>{/if}
    <Button variant="ghost" size="compact" class="prompt-skip" onclick={onskip}>Skip</Button>
  </div>
  <!-- Blank lines an extension put between parts of its title would only make the card taller. -->
  <p id={titleId} class="prompt-title">{title.replace(/\n\s*\n+/g, "\n").trim()}</p>
  {@render children()}
  <p class="prompt-hint">{hint}</p>
  {#if total}<div class="prompt-bar" style:animation-duration={`${total}ms`} aria-hidden="true"></div>{/if}
</section>

<style>
  .prompt {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    width: 100%;
    max-width: 48rem;
    margin: 0 auto;
    padding: 0.5rem 0.75rem 0.625rem;
    border: 1px solid color-mix(in srgb, var(--interactive) 50%, var(--border));
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--interactive) 5%, var(--card, var(--background)));
    font-size: var(--text-sm);
    overflow: hidden;
  }
  .prompt:focus {
    outline: none;
  }
  .prompt-head {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 1.5rem;
  }
  .prompt-mark {
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    flex: none;
    border-radius: var(--radius-full);
    background: var(--interactive);
    color: var(--background);
    font-size: 0.6875rem;
    font-weight: 700;
  }
  .prompt-label {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--interactive-text);
  }
  .prompt-title {
    margin: 0;
    font-weight: 600;
    color: var(--foreground);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .prompt-timer {
    font-size: 0.75rem;
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .prompt :global(.prompt-skip) {
    height: 1.5rem;
    padding: 0 0.5rem;
    font-size: 0.75rem;
  }
  .prompt-hint {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--subtle-foreground);
  }
  /* Touch has no keys to hint at. */
  @media (hover: none) {
    .prompt-hint {
      display: none;
    }
  }
  .prompt-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
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
