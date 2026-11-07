<script lang="ts">
  import Modal from "../../lib/ui/Modal.svelte";
  import Menu from "../../lib/ui/Menu.svelte";
  import FieldGroup from "../../lib/ui/FieldGroup.svelte";
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
  >
    {#snippet trigger()}<span style="font-size:1.1rem;letter-spacing:0.05em;color:var(--muted-foreground)" aria-hidden="true">···</span>{/snippet}
  </Menu>
{/if}
{#if open && chat}
  <Modal label="Chat info" title="Chat info" onclose={() => (open = false)}>
    <FieldGroup title="Context"
      ><dl class="space-y-3 text-xs">
        <div>
          <dt class="text-neutral-500">Persona</dt>
          <dd class="mt-1 break-words">{chat.persona?.name ?? "No persona"}</dd>
        </div>
        <div>
          <dt class="text-neutral-500">Model</dt>
          <dd class="mt-1 break-words">{modelName ?? "Not available"}</dd>
        </div>
        <div>
          <dt class="text-neutral-500">Working folder</dt>
          <dd class="mt-1 break-words">
            {client.catalog.workspaces.find((w) => w.value === chat.workspace)
              ?.label ?? chat.workspace}
          </dd>
        </div>
        <div>
          <dt class="text-neutral-500">Started</dt>
          <dd class="mt-1">
            {new Date(chat.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </dd>
        </div>
      </dl></FieldGroup
    >
    <p class="text-xs text-neutral-500">
      Stop agent ends the active agent. Your chat stays saved.
    </p>
  </Modal>
{/if}
