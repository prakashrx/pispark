<script lang="ts">
  import type { NativeMessage } from "./session-client.svelte";
  import UserTurn from "./UserTurn.svelte";
  import ToolCard from "./ToolCard.svelte";
  let { message }: { message: NativeMessage } = $props();
</script>

{#if message.role === "user"}
  <UserTurn text={message.parts.map((part) => part.text).join("\n")} />
{:else}
  <div class="space-y-4" data-purpose="assistant-turn-stream">
    {#if message.role === "toolResult"}<ToolCard
        name={message.toolName ?? "Tool"}
        target=""
        result={message.isError ? "Failed" : "Completed"}
      />{/if}
    {#each message.parts as part}
      {#if part.type === "toolCall"}<ToolCard
          name={part.name ?? "Tool"}
          target=""
          result="Requested"
        />
      {:else}<p
          class="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap break-words"
        >
          {#if part.type === "thinking"}<span class="text-xs text-zinc-500"
              >Thinking:
            </span>{/if}{part.text}
        </p>{/if}
    {/each}
    {#if message.stopReason === "aborted"}<p class="text-xs text-zinc-500">
        Cancelled
      </p>{/if}
    {#if message.stopReason === "error"}<p
        role="alert"
        class="text-xs text-zinc-700"
      >
        Model execution failed. Check account and model access, or choose another model for a new session. Configured availability does not verify subscription access.
      </p>{/if}
  </div>
{/if}
