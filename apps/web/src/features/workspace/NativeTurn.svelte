<script lang="ts">
  import type { NativeMessage } from "./session-client.svelte";
  import MessageReader from "./MessageReader.svelte";
  import UserTurn from "./UserTurn.svelte";
  import ToolCard from "./ToolCard.svelte";
  import ThoughtCard from "./ThoughtCard.svelte";
  import { renderMarkdown } from "../../lib/markdown";

  let {
    message,
    hidden = new Set<number>(),
  }: { message: NativeMessage; hidden?: Set<number> } = $props();
</script>

{#if message.role === "user"}
  <UserTurn text={message.parts.map((part) => part.text).join("\n")} />
{:else if message.role === "toolResult"}
  <ToolCard
    name={message.toolName ?? "Tool"}
    result={message.isError ? "error" : "done"}
    content={message.parts.map((p) => p.text).join("\n")}
  />
{:else}
  <div class="flex flex-col gap-3" data-purpose="assistant-turn-stream">
    {#each message.parts as part, index}
      {#if hidden.has(index)}{:else if part.type === "toolCall"}
        <ToolCard name={part.name ?? "Tool"} result="requested" />
      {:else if part.type === "thinking"}
        <ThoughtCard>{part.text}</ThoughtCard>
      {:else}
        <div class="prose max-w-none">{@html renderMarkdown(part.text)}</div>
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
{#if message.detail}{#key message.detail.key}<MessageReader reference={message.detail} />{/key}{/if}
