<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import ContributionPoint from "./ContributionPoint.svelte";
  import { commandUncertainty } from "./session-presentation";
  import { useSession, useSessions } from "./session-client.svelte";
  import type { Snippet } from "svelte";

  /**
   * The notice strip (design language §1.3): what a person must not miss about this session, one
   * at a time and the most important first, the others behind "N more". An extension's
   * `session.header` component sits under it.
   */
  const client = useSessions();
  const session = useSession();
  const doc = $derived(session.doc);
  const info = $derived(session.info);
  const connection = $derived(client.connection);
  let all = $state(false);
  const working = $derived(doc?.status === "running" || doc?.status === "cancelling" || doc?.status === "queued");
  const saidInConversation = $derived(session.items.findLast((item) => item.role === "assistant")?.stopReason === "error");

  const notices = $derived(
    [
      // PiSpark updating or out of reach is said once, by the app-wide banner.
      info && connection === "Disconnected" && !client.unreachable && !client.host.restarting ? disconnected : undefined,
      info && connection === "Unloaded" ? unloaded : undefined,
      info && connection === "Reconnecting" ? reconnecting : undefined,
      // A failed reply is said once, in the conversation where it happened (design set 8/4): not
      // again as the command's error, the session's error or "interrupted". Any other failure here.
      session.error && !(session.errorCode === "execution" && saidInConversation) ? failedHere : undefined,
      doc?.error && !(doc.error === "execution" && saidInConversation) ? failed : undefined,
      doc?.interrupted && !saidInConversation ? interrupted : undefined,
      session.shownView && info?.waiting ? waiting : undefined,
      doc?.agentChanged ? agentChanged : doc?.pending?.reload ? reloading : undefined,
      doc?.holdAsked ? holdAsked : undefined,
    ].filter((notice): notice is Snippet => !!notice),
  );
  const shown = $derived(all ? notices : notices.slice(0, 1));
  $effect(() => {
    if (notices.length < 2) all = false;
  });
</script>

{#snippet disconnected()}
  <p role="alert" class="notice">
    Connection lost. Your session may still be running. <Button size="compact" onclick={() => client.reconnect()}>Reconnect</Button>
  </p>
{/snippet}
{#snippet unloaded()}
  <p role="status" class="notice">
    This session couldn’t be opened. <Button size="compact" onclick={() => client.reconnect()}>Try again</Button>
  </p>
{/snippet}
{#snippet reconnecting()}<p role="status" class="notice">Reconnecting…</p>{/snippet}
{#snippet failedHere()}
  <div role="alert" class="notice break-words" data-tone="danger">
    <p>{commandUncertainty(session.errorKind, true) || "Something went wrong. Reopen this session to try again."}</p>
    <details>
      <summary>Details</summary>
      <p>{session.error}</p>
    </details>
  </div>
{/snippet}
{#snippet failed()}<p role="alert" class="notice" data-tone="danger">Something went wrong. Reopen this session to try again.</p>{/snippet}
{#snippet interrupted()}
  <p role="status" class="notice flex flex-wrap items-center gap-3">
    <span class="flex-1">This session was interrupted. Your saved messages are still here.</span>
    {#if !doc?.readOnly && (doc?.status === "idle" || doc?.status === "error")}<Button
        size="compact"
        onclick={() => void session.send("Continue")}>Continue</Button
      >{/if}
  </p>
{/snippet}
{#snippet waiting()}
  <p role="status" class="notice flex flex-wrap items-center gap-3">
    <span class="flex-1">This session is waiting for your answer.</span>
    <Button size="compact" onclick={() => session.showView()}>Show conversation</Button>
  </p>
{/snippet}
{#snippet agentChanged()}
  <p role="status" class="notice flex flex-wrap items-center gap-3">
    {#if doc?.pending?.reload}<span class="flex-1"
        >The agent changed. The session reloads with it when this reply finishes; your messages stay.</span
      >
    {:else}<span class="flex-1">The agent changed. Reload to apply it; your messages stay.</span>
      <Button size="compact" onclick={() => session.reload()}>{working ? "Reload after this reply" : "Reload session"}</Button>{/if}
  </p>
{/snippet}
{#snippet reloading()}<p role="status" class="notice">The session reloads when this reply finishes; your messages stay.</p>{/snippet}
{#snippet holdAsked()}
  <div role="status" class="notice flex flex-wrap items-center gap-3">
    <span class="min-w-0 flex-[1_1_20rem]"
      ><strong>{doc?.holdAsked?.extension}</strong> (an extension of {info?.agent.name}) wants to keep this session running when no one is
      watching: <em>{doc?.holdAsked?.reason}</em>.
      <span class="block text-xs text-muted-foreground"
        >Allowed, it stays loaded and starts again after PiSpark restarts. Pause all stops it.</span
      ></span
    >
    <Button size="compact" variant="primary" onclick={() => void client.hold(session.id, "allow-hold")}>Allow for {info?.agent.name}</Button
    >
    <Button size="compact" onclick={() => void client.hold(session.id, "deny-hold")}>Not now</Button>
  </div>
{/snippet}

{#each shown as notice, index (notice)}
  <div class="item">
    {@render notice()}
    {#if index === shown.length - 1 && notices.length > 1}<button
        type="button"
        class="more"
        aria-expanded={all}
        onclick={() => (all = !all)}>{all ? "Show less" : `${notices.length - 1} more`}</button
      >{/if}
  </div>
{/each}
<ContributionPoint point="session.header" />

<style>
  .item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .notice {
    padding: 0.5rem 0.875rem;
    border-radius: var(--radius);
    background: var(--muted);
    color: var(--foreground);
    font-size: var(--text-md);
    line-height: 1.5;
  }
  .notice[data-tone="danger"] {
    background: var(--danger-muted);
    color: var(--danger-foreground);
  }
  summary {
    cursor: pointer;
    width: fit-content;
    font-size: var(--text-xs);
  }
  .more {
    align-self: flex-start;
    padding: 0 0.25rem;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
