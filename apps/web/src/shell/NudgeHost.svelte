<script lang="ts">
  /**
   * The nudge (design set 9, G-17): while you are somewhere else, a session needs you. At the top of
   * the screen, under the top bar, in the accent: its mark, its name, Open and dismiss. It leaves on
   * its own after a few seconds; the sidebar's "needs you" stays.
   */
  import Icon from "../lib/ui/Icon.svelte";
  import IdentityMark from "../lib/ui/IdentityMark.svelte";
  import { href } from "../routes";
  import { attention } from "./attention.svelte";
</script>

<div class="host" aria-live="polite">
  {#if attention.nudge}
    {@const nudge = attention.nudge}
    <div
      class="nudge"
      role="group"
      aria-label={`${nudge.name} needs you`}
      onmouseenter={() => attention.holdNudge(true)}
      onmouseleave={() => attention.holdNudge(false)}
      onfocusin={() => attention.holdNudge(true)}
      onfocusout={() => attention.holdNudge(false)}
    >
      <IdentityMark name={nudge.agent} />
      <span class="what"><span class="mark" aria-hidden="true">?</span><strong class="name">{nudge.name}</strong><span class="sub">Needs you</span></span>
      <a class="open" href={href({ name: "session", id: nudge.id })} onclick={() => attention.dismissNudge()}>Open</a>
      <button type="button" class="close" aria-label="Dismiss" onclick={() => attention.dismissNudge()}><Icon name="close" class="h-4 w-4" /></button>
    </div>
  {/if}
</div>

<style>
  .host {
    position: absolute;
    top: 0.5rem;
    left: 0;
    right: 0;
    z-index: 40;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .nudge {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: min(26rem, calc(100% - 1.5rem));
    padding: 0.5rem 0.5rem 0.5rem 0.75rem;
    border: 1px solid var(--interactive);
    border-radius: var(--radius-md);
    background: var(--card, var(--background));
    box-shadow: var(--shadow-popover);
    font-size: var(--text-sm);
  }
  .what {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    border-radius: var(--radius-full);
    background: var(--interactive);
    color: var(--interactive-foreground, white);
    font-size: 0.6875rem;
    font-weight: 700;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    flex-shrink: 0;
    color: var(--muted-foreground);
  }
  .open {
    padding: 0.25rem 0.75rem;
    border-radius: var(--radius-full);
    background: var(--interactive);
    color: var(--interactive-foreground, white);
    font-weight: 600;
  }
  .close {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
  }
  .close:hover {
    background: var(--accent);
    color: var(--foreground);
  }
</style>
