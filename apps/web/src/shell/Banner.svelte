<script lang="ts">
  /**
   * What concerns the whole workspace (design language §3.2, set 8), under every screen's top bar,
   * one cause one message: PiSpark updating, then back on a newer version; PiSpark out of reach
   * (sessions keep running on the computer); another failure with its details; or a note about the
   * list. A session's own trouble stays on its screen.
   */
  import Button from "../lib/ui/Button.svelte";
  import { useSessions } from "../features/workspace/session-client.svelte";
  import { commandUncertainty } from "../features/workspace/session-presentation";
  const sessions = useSessions();
  const host = sessions.host;
  // From another device the server can be running while out of reach; on its own computer, it has likely stopped.
  const here = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

  // Back on a newer version: reload by itself when nothing is typed; otherwise offer it.
  const typed = $derived(!!sessions.askDraft.trim() || !!sessions.current?.draft.trim());
  $effect(() => {
    if (host.updated && !host.restarting && !typed) location.reload();
  });
</script>

{#snippet details()}
  {#if sessions.error}<details>
      <summary>Details</summary>
      <p class="break-words">{sessions.error}</p>
    </details>{/if}
{/snippet}

{#if host.restarting}
  <p role="status" class="banner" data-tone="info" data-purpose="updating">
    <span class="spin" aria-hidden="true"></span><span>
      <strong>Updating PiSpark to v{host.restarting}…</strong> Back in a few seconds. Your draft is kept.
    </span>
  </p>
{:else if host.updated}
  <p role="status" class="banner" data-tone="info">
    <span><strong>Updated to v{host.updated}.</strong> Reload to use it; what you typed is lost on reload.</span>
    <Button size="compact" onclick={() => location.reload()}>Reload</Button>
  </p>
{:else if sessions.unreachable}
  <div role="alert" class="banner" data-tone="dark">
    <p>
      <strong>Can’t reach PiSpark</strong>{sessions.retrying ? " · retrying" : ""} · {here
        ? "it may have stopped on this computer"
        : "your sessions keep running on the computer"}
      <button type="button" class="link" onclick={() => sessions.reconnect()}>Retry now</button>
    </p>
    {@render details()}
  </div>
{:else if sessions.error}
  <div role="alert" class="banner" data-tone="danger">
    <p>{commandUncertainty(sessions.errorKind, false) || "Couldn’t complete that action. Your draft is still here."}</p>
    {@render details()}
  </div>
{/if}
{#if sessions.listNotice}<p role="status" class="banner" data-tone="info">{sessions.listNotice}</p>{/if}

<style>
  .banner {
    flex-shrink: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    padding: 0.5rem 1rem;
    font-size: var(--text-sm);
    line-height: 1.5;
    border-bottom: 1px solid var(--border);
  }
  div.banner {
    display: block;
  }
  .banner[data-tone="info"] {
    background: var(--interactive-muted);
  }
  .banner[data-tone="danger"] {
    background: var(--danger-muted);
    color: var(--danger-foreground);
  }
  .banner[data-tone="dark"] {
    background: var(--foreground);
    color: var(--background);
    border-color: var(--foreground);
  }
  .link {
    margin-left: 0.5rem;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
    color: inherit;
  }
  summary {
    cursor: pointer;
    width: fit-content;
    font-size: var(--text-xs);
  }
  .spin {
    width: 0.75rem;
    height: 0.75rem;
    flex-shrink: 0;
    border-radius: 9999px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: spin 1s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
