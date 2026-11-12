<script lang="ts">
  import MessageReader from "./MessageReader.svelte";
  import UserTurn from "./UserTurn.svelte";
  import { clippedPart, itemText, type Turn } from "./chat-turns";
  import "./default-views";
  import { resolveSegmentView } from "./views.svelte";
  import ContributionPoint from "./ContributionPoint.svelte";
  import { placedPoints, pointOf } from "./extension-views";
  import { useChat } from "./session-client.svelte";

  /**
   * One turn: your message, then everything the agent did and said, in order. Each segment is drawn
   * by an extension's component when one is placed at its point, else by the view registered for its
   * kind, so this component knows no kind by name.
   */
  let { turn, sessionId }: { turn: Turn; sessionId: string } = $props();
  const chat = useChat();
  // What extensions placed components for; such a part is drawn by them instead of PiSpark's view.
  const placed = $derived(placedPoints(chat.doc?.extensions));
  // Text cut at its limit ends where the cut was, not mid-word as if it were whole.
  const ellipsis = (text: string, cut: boolean) => (cut ? `${text.trimEnd()}…` : text);
</script>

<div class="turn" data-purpose="turn">
  {#if turn.user}
    {@const detail = clippedPart(turn.user)}
    <UserTurn text={ellipsis(itemText(turn.user), !!detail)} />
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
</div>

<style>
  .turn {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
  }
  .response {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }
</style>
