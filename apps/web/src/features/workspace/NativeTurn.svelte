<script lang="ts">
  import type { NativeMessage } from "./session-client.svelte";
  import UserTurn from "./UserTurn.svelte";
  import ToolCard from "./ToolCard.svelte";
  import ThoughtCard from "./ThoughtCard.svelte";
  import { renderMarkdown } from "../../lib/markdown";

  let { message }: { message: NativeMessage } = $props();

  // Group consecutive thinking parts for the ThoughtCard
  // Non-thinking, non-toolCall parts get rendered as markdown
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
  <div class="space-y-3" data-purpose="assistant-turn-stream">
    {#each message.parts as part}
      {#if part.type === "toolCall"}
        <ToolCard name={part.name ?? "Tool"} result="running" />
      {:else if part.type === "thinking"}
        <ThoughtCard>{part.text}</ThoughtCard>
      {:else}
        <div class="prose max-w-none">{@html renderMarkdown(part.text)}</div>
      {/if}
    {/each}
    {#if message.stopReason === "aborted"}
      <p class="text-xs text-zinc-400 italic">Cancelled</p>
    {/if}
    {#if message.stopReason === "error"}
      <p role="alert" class="text-xs text-zinc-500">
        Model execution failed. Check account and model access, or choose another model for a new session.
      </p>
    {/if}
  </div>
{/if}
