<script lang="ts">
  import Popover from "../../lib/ui/Popover.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { useSessions } from "./session-client.svelte";
  /**
   * Facts about the open chat, anchored to an info button in the chat header so the
   * conversation never moves. Stopping the agent lives here, next to its explanation.
   */
  const client = useSessions();
  const snapshot = $derived(client.snapshot);
  const chat = $derived(
    snapshot ?? client.sessions.find((s) => s.id === client.selected),
  );
  const model = $derived(snapshot?.model);
  const modelName = $derived(
    client.providers.catalog.providers
      .find((p) => p.id === model?.provider)
      ?.models.find((m) => m.id === model?.id)?.name ?? model?.id,
  );
</script>

{#if chat}
  <Popover label="Chat info">
    {#snippet trigger()}<Icon name="info" class="h-[18px] w-[18px]" />{/snippet}
    {#snippet children(close)}
      <section
        aria-label="Chat info"
        tabindex="-1"
        data-autofocus
        class="w-[min(19rem,80vw)] space-y-3 p-3 outline-none"
      >
        <h2 class="text-sm font-semibold">Chat info</h2>
        <dl class="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 text-sm">
          <dt class="text-muted-foreground">Persona</dt>
          <dd class="break-words">{chat.persona?.name ?? "No persona"}</dd>
          <dt class="text-muted-foreground">Model</dt>
          <dd class="break-words">{modelName ?? "Not available"}</dd>
          <dt class="text-muted-foreground">Working folder</dt>
          <dd class="break-words">
            {client.catalog.workspaces.find((w) => w.value === chat.workspace)
              ?.label ?? chat.workspace}
          </dd>
          <dt class="text-muted-foreground">Started</dt>
          <dd>
            {new Date(chat.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </dd>
        </dl>
        {#if snapshot}<div
            class="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3"
          >
            <p class="text-xs text-muted-foreground">
              Ends the running agent. The chat stays saved and can be reopened.
            </p>
            <Button
              size="compact"
              class="shrink-0 whitespace-nowrap"
              onclick={() => {
                close();
                void client.stop();
              }}>Stop agent</Button
            >
          </div>{/if}
      </section>
    {/snippet}
  </Popover>
{/if}
