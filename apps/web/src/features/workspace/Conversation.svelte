<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import { tick } from "svelte";
  import SessionHeader from "./SessionHeader.svelte";
  import ResponseTurn from "./ResponseTurn.svelte";
  import { buildTurns } from "./chat-turns";
  import UserTurn from "./UserTurn.svelte";
  import { placedPoints } from "./extension-views";
  import { useSession } from "./session-client.svelte";

  /** PiSpark's own conversation: the chat's items as turns, in one continuous scroll. */
  const session = useSession();
  const doc = $derived(session.doc);
  const placed = $derived(placedPoints(doc?.extensions));
  const queued = $derived((doc?.queue.steering ?? 0) + (doc?.queue.followUp ?? 0));
  const running = $derived(["running", "cancelling"].includes(doc?.status ?? ""));
  // The chat as turns of ordered segments; extension notices land where they happened.
  const turns = $derived(
    doc
      ? buildTurns(session.items, {
          running,
          notices: doc.extensions.notices,
          thinkingLabel: doc.extensions.thinkingLabel,
          progress: session.progress,
          placed: (point) => placed.has(point),
        })
      : [],
  );

  // One continuous scroll: older items are read in above as you reach the top, the view stays
  // where it was, and new output follows while you are at the bottom. Following stops only when
  // you scroll up, not because something grew below you, and starts again at the bottom.
  let scroller = $state<HTMLElement>();
  let column = $state<HTMLElement>();
  let top = $state<HTMLElement>();
  let following = $state(true);
  let lastTop = 0;
  let loadingEarlier = $state(false);
  let earlierFailed = $state(false);
  const atBottom = () =>
    !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  async function earlier() {
    if (loadingEarlier || !session.more || !scroller) return;
    loadingEarlier = true;
    const fromBottom = scroller.scrollHeight - scroller.scrollTop;
    earlierFailed = !(await session.loadEarlier());
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight - fromBottom;
    loadingEarlier = false;
    // Still at the top (the older page did not fill the view): keep reading.
    if (scroller && scroller.scrollTop < 40 && session.more && !earlierFailed) void earlier();
  }
  $effect(() => {
    if (!scroller || !top) return;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !earlierFailed) void earlier();
      },
      { root: scroller },
    );
    watcher.observe(top);
    return () => watcher.disconnect();
  });
  function toBottom() {
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    lastTop = scroller.scrollTop;
  }
  function onscroll() {
    if (!scroller) return;
    if (atBottom()) following = true;
    else if (scroller.scrollTop < lastTop - 2) following = false;
    lastTop = scroller.scrollTop;
  }
  // Anything that makes the conversation taller (a reply, a late image, a diff, a question) keeps
  // the end in view while following.
  $effect(() => {
    if (!column) return;
    const watcher = new ResizeObserver(() => {
      if (following) toBottom();
    });
    watcher.observe(column);
    return () => watcher.disconnect();
  });
  function jumpToLatest() {
    following = true;
    toBottom();
  }
  const button = "conversation-action";
</script>

<main
  id="workspace"
  aria-label="Chat conversation"
  class="conversation flex-1 overflow-y-auto px-6 pt-8 pb-6 flex flex-col items-center"
  bind:this={scroller}
  {onscroll}
>
  <div class="w-full max-w-3xl flex flex-col gap-8" bind:this={column}>
    <SessionHeader />
    {#if doc}
      {#if queued > 0}<p class="text-sm text-muted-foreground">
          {queued} messages queued
        </p>{/if}
      <div bind:this={top} aria-hidden="true"></div>
      {#if loadingEarlier}<p role="status" class="text-sm text-muted-foreground">Loading earlier messages…</p>
      {:else if session.more && earlierFailed}<Button
          class={button}
          onclick={() => {
            earlierFailed = false;
            void earlier();
          }}>Load earlier messages</Button
        >{/if}
      <div class="flex flex-col gap-8">
        {#each turns as turn (turn.key)}
          <ResponseTurn {turn} sessionId={session.id} />
        {/each}
        {#if doc.status === "queued" && doc.queuedText}<div class="queued-turn">
            <UserTurn text={doc.queuedText} />
            <p role="status" class="queued-note">
              {doc.restored ? "Queued from before PiSpark restarted." : "Queued."} Starts when another chat finishes.
            </p>
          </div>{/if}
      </div>
    {/if}
    <div class="h-10"></div>
    {#if !following && turns.length}<div class="jump">
        <Button class={button} onclick={jumpToLatest}>Jump to latest</Button>
      </div>{/if}
  </div>
</main>

<style>
  /* Prepending older items must not move what you are reading; the position is restored by hand. */
  .conversation {
    overflow-anchor: none;
  }
  .queued-turn {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.5rem;
    opacity: 0.75;
  }
  .queued-note {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
  .jump {
    position: sticky;
    bottom: 0.5rem;
    display: flex;
    justify-content: center;
    pointer-events: none;
    margin-top: -2.5rem;
  }
  .jump :global(.ui-button) {
    pointer-events: auto;
  }
</style>
