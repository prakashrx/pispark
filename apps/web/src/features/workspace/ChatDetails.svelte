<script lang="ts">
  import InlinePanel from "../../lib/ui/InlinePanel.svelte";
  import Menu from "../../lib/ui/Menu.svelte";
    import { useSessions } from "./session-client.svelte";
  const client = useSessions();
  let open = $state(false);
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
  <Menu
    label="Chat actions"
    items={[
      { id: "info", label: "Chat info", onselect: () => (open = true) },
      {
        id: "stop",
        label: "Stop agent",
        disabled: !snapshot,
        onselect: () => void client.stop(),
      },
    ]}
  />
{/if}
{#if open && chat}<div class="basis-full">
  <InlinePanel label="Chat info" title="Chat info" onclose={() => (open = false)}>
    <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2.5 text-sm">
        <div class="contents">
          <dt class="text-muted-foreground">Persona</dt>
          <dd class="break-words">{chat.persona?.name ?? "No persona"}</dd>
        </div>
        <div class="contents">
          <dt class="text-muted-foreground">Model</dt>
          <dd class="break-words">{modelName ?? "Not available"}</dd>
        </div>
        <div class="contents">
          <dt class="text-muted-foreground">Working folder</dt>
          <dd class="break-words">
            {client.catalog.workspaces.find((w) => w.value === chat.workspace)
              ?.label ?? chat.workspace}
          </dd>
        </div>
        <div class="contents">
          <dt class="text-muted-foreground">Started</dt>
          <dd>
            {new Date(chat.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </dd>
        </div>
    </dl>
    <p class="text-sm text-muted-foreground">
      Stop agent ends the active agent. Your chat stays saved.
    </p>
  </InlinePanel>
</div>{/if}
