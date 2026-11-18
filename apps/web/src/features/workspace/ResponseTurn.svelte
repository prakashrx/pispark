<script lang="ts">
  import TurnTime from "./TurnTime.svelte";
  import MessageReader from "./MessageReader.svelte";
  import UserTurn from "./UserTurn.svelte";
  import { clippedPart, itemText, type Turn } from "./session-turns";
  import "./default-views";
  import { resolveSegmentView } from "./views.svelte";
  import ContributionPoint from "./ContributionPoint.svelte";
  import { placedPoints, pointOf } from "./extension-views";
  import { useSession } from "./session-client.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { attention } from "../../shell/attention.svelte";

  /**
   * One turn: your message, then everything the agent did and said, in order. Each segment is drawn
   * by an extension's component when one is placed at its point, else by the view registered for its
   * kind, so this component knows no kind by name.
   */
  let { turn, sessionId }: { turn: Turn; sessionId: string } = $props();
  const session = useSession();
  // What extensions placed components for; such a part is drawn by them instead of PiSpark's view.
  const placed = $derived(placedPoints(session.doc?.extensions));
  // Text cut at its limit ends where the cut was, not mid-word as if it were whole.
  const ellipsis = (text: string, cut: boolean) => (cut ? `${text.trimEnd()}…` : text);
  // Copy (C-20): the reply's text as it was written (Markdown), once it is finished.
  const replyText = $derived(
    turn.segments
      .flatMap((segment) => (segment.kind === "text" ? [segment.text] : []))
      .join("\n\n")
      .trim(),
  );
  async function copyReply() {
    try {
      await navigator.clipboard.writeText(replyText);
      attention.say("Reply copied");
    } catch {
      attention.say("Couldn’t copy the reply");
    }
  }
</script>

<div class="turn" data-purpose="turn">
  {#if turn.user}
    {@const detail = clippedPart(turn.user)}
    <UserTurn text={ellipsis(itemText(turn.user), !!detail)} woken={turn.woken} from={turn.from} />
    {#if detail}{#key detail.id}<MessageReader reference={detail} />{/key}{/if}
  {/if}
  {#if turn.segments.length}
    <div class="response" data-purpose="assistant-turn-stream">
      {#each turn.segments as segment (segment.key)}
        {@const extension = pointOf(segment)}
        {#if extension && placed.has(extension.point)}
          <ContributionPoint point={extension.point} data={extension.data} />
        {:else}
          {@const View = resolveSegmentView(segment.kind)}
          {#if View}<View {segment} {sessionId} />{/if}
        {/if}
      {/each}
    </div>
  {/if}
  <div class="foot">
    <TurnTime {turn} />
    {#if !turn.running && replyText}<button type="button" class="copy" aria-label="Copy reply" title="Copy reply" onclick={() => void copyReply()}
        ><Icon name="copy" class="h-3.5 w-3.5" /></button
      >{/if}
  </div>
</div>

<style>
  .turn {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-top: -0.25rem;
    min-height: 1.5rem;
  }
  .foot :global(.turn-time) {
    margin-top: 0;
  }
  /* Quiet until reached for: faint, clear on hover or focus. */
  .copy {
    display: inline-grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
    opacity: 0.6;
  }
  .copy:hover,
  .copy:focus-visible {
    opacity: 1;
    background: var(--accent);
    color: var(--foreground);
  }
  .response {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    min-width: 0;
  }
</style>
