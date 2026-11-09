<script lang="ts">
  import type { NativeMessage } from "./session-client.svelte";
  import MessageReader from "./MessageReader.svelte";
  import UserTurn from "./UserTurn.svelte";
  import ToolCard from "./ToolCard.svelte";
  import ThoughtCard from "./ThoughtCard.svelte";
  import ExtensionBlock from "./ExtensionBlock.svelte";
  import { renderMarkdown } from "../../lib/markdown";

  let {
    message,
    hidden = new Set<number>(),
    thinkingLabel,
  }: { message: NativeMessage; hidden?: Set<number>; thinkingLabel?: string } = $props();
  // A clipped reply ends where the text budget ran out, often mid-word; mark the cut.
  const lastText = $derived(
    message.detail
      ? message.parts.findLastIndex(
          (part, index) =>
            !hidden.has(index) &&
            part.type !== "toolCall" &&
            part.type !== "thinking",
        )
      : -1,
  );
  const ellipsis = (text: string, clipped: boolean) =>
    clipped ? `${text.trimEnd()}…` : text;
</script>

{#if message.role === "user"}
  <UserTurn
    text={ellipsis(
      message.parts.map((part) => part.text).join("\n"),
      !!message.detail,
    )}
  />
{:else if message.role === "toolResult"}
  <ToolCard
    name={message.toolName ?? "Tool"}
    result={message.isError ? "error" : "done"}
    content={message.parts.map((p) => p.text).join("\n")}
    rendered={message.rendered}
  />
{:else if message.role === "custom" && message.rendered?.body}
  <ExtensionBlock lines={message.rendered.body} />
{:else}
  <div class="flex flex-col gap-3" data-purpose="assistant-turn-stream">
    {#each message.parts as part, index}
      {#if hidden.has(index)}{:else if part.type === "toolCall"}
        <ToolCard name={part.name ?? "Tool"} result="requested" />
      {:else if part.type === "thinking"}
        <ThoughtCard label={thinkingLabel}>{part.text}</ThoughtCard>
      {:else}
        <div class="prose max-w-none">{@html renderMarkdown(ellipsis(part.text, index === lastText))}</div>
      {/if}
    {/each}
    {#if message.stopReason === "aborted"}
      <p class="text-sm text-subtle italic">Cancelled</p>
    {/if}
    {#if message.stopReason === "error"}
      <p role="alert" class="text-sm px-4 py-3 rounded-xl bg-[var(--danger-muted)] text-[var(--danger-foreground)]">
        Model execution failed. Check account and model access, or choose another model for a new session.
      </p>
    {/if}
  </div>
{/if}
{#if message.detail}{#key message.detail.id}<MessageReader reference={message.detail} />{/key}{/if}
