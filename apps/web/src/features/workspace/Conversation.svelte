<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import { tick } from "svelte";
  import { useScreen } from "../../shell/screen-context";
  import ResponseTurn from "./ResponseTurn.svelte";
  import { buildTurns } from "./session-turns";
  import UserTurn from "./UserTurn.svelte";
  import { placedPoints } from "./extension-views";
  import { useSession } from "./session-client.svelte";

  /** PiSpark's own conversation: the session's items as turns, in one continuous scroll. */
  const session = useSession();
  const doc = $derived(session.doc);
  const placed = $derived(placedPoints(doc?.extensions));
  const running = $derived(["running", "cancelling"].includes(doc?.status ?? ""));
  // The session as turns of ordered segments; extension notices land where they happened.
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
  // The screen's Main is the scroll (design language §1.4), so the bars and the composer stay put.
  const screen = useScreen();
  const scroller = $derived(screen?.main);
  let column = $state<HTMLElement>();
  let top = $state<HTMLElement>();
  let following = $state(session.readingTop === undefined);
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
  $effect(() => {
    const element = scroller;
    if (!element) return;
    if (session.readingTop !== undefined) {
      element.scrollTop = session.readingTop;
      lastTop = element.scrollTop;
    }
    element.addEventListener("scroll", onscroll, { passive: true });
    return () => element.removeEventListener("scroll", onscroll);
  });
  function onscroll() {
    if (!scroller) return;
    if (atBottom()) following = true;
    else if (scroller.scrollTop < lastTop - 2) following = false;
    lastTop = scroller.scrollTop;
    session.readingTop = following ? undefined : lastTop;
  }
  // Anything that makes the conversation taller (a reply, a late image, a diff, a question) keeps
  // the end in view while following.
  $effect(() => {
    if (!column || !scroller) return;
    const watcher = new ResizeObserver(() => {
      if (following) toBottom();
    });
    watcher.observe(column);
    watcher.observe(scroller);
    return () => watcher.disconnect();
  });
  function jumpToLatest() {
    session.readingTop = undefined;
    following = true;
    toBottom();
  }
  const button = "conversation-action";
</script>

<div class="conversation py-4 flex flex-col items-center">
  <div class="conversation-content w-full min-w-0 flex flex-col gap-6" bind:this={column}>
    {#if doc}
      <div bind:this={top} aria-hidden="true"></div>
      {#if loadingEarlier}<p role="status" class="text-sm text-muted-foreground">Loading earlier messages…</p>
      {:else if session.more && earlierFailed}<Button
          class={button}
          onclick={() => {
            earlierFailed = false;
            void earlier();
          }}>Load earlier messages</Button
        >{/if}
      <div class="flex flex-col gap-6">
        {#each turns as turn (turn.key)}
          <ResponseTurn {turn} sessionId={session.id} />
        {/each}
        {#if doc.status === "queued" && doc.queuedText}<div class="queued-turn">
            <UserTurn text={doc.queuedText} />
            <p role="status" class="queued-note">
              {doc.restored ? "Queued from before PiSpark restarted." : "Queued."} Starts when another session finishes.
            </p>
          </div>{/if}
      </div>
    {/if}
    <div class="h-10"></div>
    {#if !following && turns.length}<div class="jump">
        <Button class={button} onclick={jumpToLatest}>Jump to latest</Button>
      </div>{/if}
  </div>
</div>

<style>
  /* Prepending older items must not move what you are reading; the position is restored by hand. */
  .conversation {
    overflow-anchor: none;
    padding-inline: var(--conversation-gutter);
  }
  .conversation-content { max-width: var(--conversation-width); }
  .queued-turn {
    width: min(100%, var(--conversation-reading-width));
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
