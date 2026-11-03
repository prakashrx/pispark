<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import { useSessions } from "./session-client.svelte";
  const client = useSessions();
  const snapshot = $derived(client.snapshot);
  const chat = $derived(
    snapshot ?? client.sessions.find((s) => s.id === client.selected),
  );
</script>

{#if chat}<details class="text-xs text-zinc-500 space-y-2">
    <summary class="cursor-pointer">Chat details</summary>
    <dl class="space-y-1 break-all mt-2">
      <dt>Working folder</dt>
      <dd>
        {client.catalog.workspaces.find((w) => w.value === chat.workspace)
          ?.label ?? chat.workspace} ({chat.workspace})
      </dd>
      <dt>Chat setup</dt>
      <dd>{chat.configuration}</dd>
      <dt>Chat ID</dt>
      <dd>{chat.id}</dd>
      <dt>Created</dt>
      <dd>{chat.createdAt}</dd>
      <dt>Status</dt>
      <dd>{chat.status}</dd>
      <dt>Connection</dt>
      <dd>{client.connection}</dd>
      {#if chat.persona}<dt>Persona</dt>
        <dd>{chat.persona.name}</dd>
        <dt>Persona reference</dt>
        <dd>{JSON.stringify(chat.persona.ref)}</dd>
        <dt>Revision</dt>
        <dd>{chat.persona.revision}</dd>
        <dt>Effective revision</dt>
        <dd>{chat.persona.effectiveRevision}</dd>{/if}
      {#if snapshot?.model}<dt>Model</dt>
        <dd>{snapshot.model.provider}/{snapshot.model.id}</dd>{/if}
      {#if snapshot}<dt>Queue</dt>
        <dd>
          {snapshot.queue.steering} steering, {snapshot.queue.followUp} follow-up
        </dd>
        <dt>History window</dt>
        <dd>
          {snapshot.messages.length} messages shown; {snapshot.total} in current
          context; earlier boundary {snapshot.before}. Each window shows at most
          20 messages plus the current response, 16 content parts per message,
          4,096 characters per field and 24,000 content characters total. Images
          and tool arguments are omitted.
        </dd>{/if}
      {#if snapshot?.error}<dt>Error code</dt>
        <dd>{snapshot.error}</dd>{/if}
    </dl>
    {#if snapshot}<div class="space-y-2 mt-3">
        <Button class="source-action" onclick={() => client.stop()}
          >Stop agent</Button
        >
        <p>Your chat stays saved and can be reopened.</p>
      </div>{/if}
  </details>{/if}
