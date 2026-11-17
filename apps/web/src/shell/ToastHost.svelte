<script lang="ts">
  /**
   * The result toast (design set 9): at the bottom over the screen, just above the composer on a
   * session so it never covers it. Announced politely; stays while the pointer or focus is on it.
   */
  import { attention } from "./attention.svelte";
  /** How far above the bottom: more over the phone's bottom bar. */
  let { bottom = "0.75rem" }: { bottom?: string } = $props();
</script>

<div class="host" role="status" aria-live="polite" style:bottom>
  {#if attention.toast}
    {@const toast = attention.toast}
    {#key toast.id}
      <div
        class="toast"
        role="presentation"
        onmouseenter={() => attention.holdToast(true)}
        onmouseleave={() => attention.holdToast(false)}
        onfocusin={() => attention.holdToast(true)}
        onfocusout={() => attention.holdToast(false)}
      >
        <span>{toast.text}</span>
        {#if toast.action}<button
            type="button"
            class="action"
            onclick={() => {
              toast.action!.run();
              attention.dismissToast();
            }}>{toast.action.label}</button
          >{/if}
      </div>
    {/key}
  {/if}
</div>

<style>
  .host {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 40;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 1rem;
    max-width: min(32rem, calc(100% - 2rem));
    padding: 0.625rem 1rem;
    border-radius: var(--radius-md);
    background: var(--foreground);
    color: var(--background);
    font-size: var(--text-sm);
    box-shadow: var(--shadow-popover);
    animation: toast-in 0.16s ease-out;
  }
  .action {
    flex-shrink: 0;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
    color: inherit;
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(0.5rem);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
