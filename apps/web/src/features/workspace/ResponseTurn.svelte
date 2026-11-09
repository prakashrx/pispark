<script lang="ts">
  import ActivityGroup from "./ActivityGroup.svelte";
  import ArtifactImage from "./ArtifactImage.svelte";
  import DiffView from "./DiffView.svelte";
  import ExtensionBlock from "./ExtensionBlock.svelte";
  import MessageReader from "./MessageReader.svelte";
  import StreamingMarkdown from "./StreamingMarkdown.svelte";
  import ThoughtCard from "./ThoughtCard.svelte";
  import UserTurn from "./UserTurn.svelte";
  import { clippedPart, itemText, type Turn } from "./chat-turns";

  /** One turn: your message, then everything the agent did and said, in order. */
  let { turn, sessionId, thinkingLabel }: { turn: Turn; sessionId: string; thinkingLabel?: string } = $props();
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
        {#if segment.kind === "text"}
          <div class="segment">
            <StreamingMarkdown text={ellipsis(segment.text, segment.size !== undefined)} streaming={segment.streaming} />
            {#if segment.detail}{#key segment.detail.id}<MessageReader reference={segment.detail} />{/key}{/if}
          </div>
        {:else if segment.kind === "thinking"}
          <ThoughtCard label={segment.streaming ? "Thinking…" : thinkingLabel}>{segment.text}</ThoughtCard>
        {:else if segment.kind === "activity"}
          <ActivityGroup calls={segment.calls} live={segment.live} />
        {:else if segment.kind === "custom"}
          {#if segment.item.rendered?.body}
            <ExtensionBlock lines={segment.item.rendered.body} />
          {:else}
            <StreamingMarkdown text={itemText(segment.item)} />
          {/if}
        {:else if segment.kind === "summary"}
          <ThoughtCard label="Earlier messages were summarized">{segment.text}</ThoughtCard>
        {:else if segment.kind === "notice"}
          <ExtensionBlock lines={segment.notice.lines} kind={segment.notice.kind} />
        {:else if segment.kind === "diff"}
          <DiffView patch={segment.patch} path={segment.path} />
        {:else if segment.kind === "image"}
          <ArtifactImage {sessionId} itemId={segment.itemId} part={segment.part} mimeType={segment.mimeType} alt={segment.alt} />
        {:else if segment.kind === "svg"}
          <ArtifactImage {sessionId} markup={segment.markup} alt={segment.alt} />
        {:else if segment.reason === "aborted"}
          <p class="text-sm text-subtle italic">Cancelled</p>
        {:else}
          <p role="alert" class="text-sm px-4 py-3 rounded-xl bg-[var(--danger-muted)] text-[var(--danger-foreground)]">
            Model execution failed. Check account and model access, or choose another model for a new session.
          </p>
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
  .segment {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
</style>
