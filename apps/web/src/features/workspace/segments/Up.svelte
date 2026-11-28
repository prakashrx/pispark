<script lang="ts">
  /**
   * What this session sent up to whoever asked it: a note, or a raise. In a child that is its
   * parent. In a session the person started it is the person, and a raise that still waits for
   * them is the one loud thing in the conversation: it needs you, and a reply answers it.
   */
  import Icon from "../../../lib/ui/Icon.svelte";
  import StatusMark from "../../../lib/ui/StatusMark.svelte";
  import { useSession, useSessions } from "../session-client.svelte";
  import { sessionName } from "../session-presentation";
  import type { Segment } from "../session-turns";

  let { segment }: { segment: Extract<Segment, { kind: "up" }> } = $props();
  const client = useSessions();
  const session = useSession();
  const info = $derived(session.info);
  const parent = $derived(info?.ask ? client.sessions.find((each) => each.id === info.parent) : undefined);
  const to = $derived(info?.ask ? (parent ? sessionName(parent) : "its parent") : "you");
  // What it raised is kept short on the server; the same words, as far as they go, are the same raise.
  const raised = $derived(info?.raised);
  const waits = $derived(segment.what === "raise" && !!raised && segment.text.startsWith(raised.replace(/…$/, "")));
</script>

{#if waits}
  <div class="needs" role="status" data-purpose="needs-you">
    <StatusMark kind="attention" label="Needs you" words />
    <p class="words">{segment.text}</p>
    <p class="hint">Reply below to answer.</p>
  </div>
{:else}
  <p class="up" data-purpose="sent-up">
    <Icon name="arrowUp" class="h-3.5 w-3.5 shrink-0" /><span>{segment.what === "note" ? `Note for ${to}` : `Asked ${to}`} · {segment.text}</span>
  </p>
{/if}

<style>
  .up {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
  .up :global(svg) {
    align-self: center;
  }
  .needs {
    align-self: flex-start;
    max-width: min(36rem, 100%);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.625rem 0.875rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--interactive-muted);
  }
  .words {
    font-size: var(--text-sm);
    white-space: pre-wrap;
  }
  .hint {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
