<script lang="ts">
  /**
   * One row per ask, at the place it was asked. It changes in place: how the ask stands, how long
   * it has worked, the child's last note or its question, and its answer folded inside. The name
   * opens the child. A child that was not kept is put away once it is done: its row then says how
   * the ask ended, and opening it brings the child back.
   */
  import Icon from "../../../lib/ui/Icon.svelte";
  import AskMark from "../../started/AskMark.svelte";
  import { askLine, endedState } from "../../started/work";
  import { useNow } from "../../../lib/clock.svelte";
  import { useSessions } from "../session-client.svelte";
  import { sessionName } from "../session-presentation";
  import SessionMarkdown from "../SessionMarkdown.svelte";
  import type { Segment } from "../session-turns";

  let { segment }: { segment: Extract<Segment, { kind: "session" }> } = $props();
  const client = useSessions();
  const child = $derived(client.sessions.find((s) => s.id === segment.sessionId));
  const ask = $derived(child?.ask);
  // Just started, it may not be in the list yet: look once, rather than wait for the next refresh.
  let looked = $state(false);
  $effect(() => {
    if (child || looked) return;
    void client
      .refresh()
      .catch(() => {})
      .finally(() => (looked = true));
  });
  const clock = useNow(() => ask?.state === "working");
  let open = $state(false);
  // Not in the list any more: put away. What this conversation heard says how its ask ended.
  const ended = $derived(endedState(segment.how));
  async function bringBack() {
    if (await client.restore(segment.sessionId)) client.open(segment.sessionId);
  }
</script>

<div class="ask" data-purpose="ask-row" data-state={ask?.state ?? ended}>
  <div class="line">
    {#if child && ask}
      <button type="button" class="go" onclick={() => client.open(child.id)}>
        <AskMark state={ask.state} />
        <span class="title"><span class="sr-only">Open </span>{sessionName(child)}</span>
        <span class="state">{askLine(child, clock.now)}</span>
      </button>
    {:else if looked}
      <button type="button" class="go" onclick={bringBack}>
        {#if ended}<AskMark state={ended} />{:else}<Icon name="sessionOut" class="h-3.5 w-3.5 shrink-0" />{/if}
        <span class="title"><span class="sr-only">Open </span>{segment.title}</span>
        <span class="state">{ended ?? "put away"}</span>
      </button>
    {:else}
      <span class="go"><Icon name="sessionOut" class="h-3.5 w-3.5 shrink-0" /><span class="title">{segment.title}</span><span class="state">starting…</span></span>
    {/if}
    {#if segment.answer}
      <button type="button" class="fold" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} the answer from ${segment.title}`} onclick={() => (open = !open)}>
        <Icon name={open ? "chevronDown" : "chevronRight"} class="h-3.5 w-3.5" />
      </button>
    {/if}
  </div>
  {#if ask?.state === "working" && ask.note}<p class="under">{ask.note}</p>{/if}
  {#if ask?.state === "asked" && ask.question}<p class="under">“{ask.question}”</p>{/if}
  {#if open && segment.answer}<div class="answer"><SessionMarkdown text={segment.answer} /></div>{/if}
</div>

<style>
  .ask {
    align-self: flex-start;
    max-width: 100%;
    min-width: 0;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    margin: 0 -0.5rem;
  }
  .go {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.875rem;
    padding: 0 0.5rem;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    color: var(--foreground);
    text-align: left;
  }
  button.go:hover,
  .fold:hover {
    background: var(--muted);
  }
  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .state::before {
    content: "· ";
  }
  .fold {
    width: 1.75rem;
    height: 1.75rem;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
  }
  .under {
    padding-left: 1.625rem;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .answer {
    margin: 0.25rem 0 0.25rem 0.5rem;
    padding-left: 1rem;
    border-left: 2px solid var(--border);
  }
  /* Compact: the state goes under the name, and the targets are full size. */
  @media (max-width: 599px) {
    .go {
      min-height: 2.25rem;
      flex-wrap: wrap;
      row-gap: 0;
      padding-top: 0.25rem;
      padding-bottom: 0.25rem;
    }
    .title {
      flex: 1;
    }
    .state {
      flex-basis: 100%;
      padding-left: 1.625rem;
    }
    .state::before {
      content: none;
    }
    .fold {
      width: 2.25rem;
      height: 2.25rem;
    }
  }
</style>
