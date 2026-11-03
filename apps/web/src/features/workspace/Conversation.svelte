<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import NativeTurn from "./NativeTurn.svelte";
  import { useSessions } from "./session-client.svelte";
  const client = useSessions();
  const snapshot = $derived(client.snapshot);
  const button =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-700 bg-white hover:bg-zinc-50 border border-zinc-200 shadow-elevation-sm";
</script>

<main
  id="workspace"
  aria-label="Session conversation"
  class="flex-1 overflow-y-auto px-6 py-8 flex flex-col items-center"
>
  <div class="w-full max-w-4xl flex flex-col space-y-8">
    <header
      class="flex items-start justify-between pb-4 border-b border-zinc-100"
    >
      <div>
        <div class="flex items-center gap-3">
          <h1 class="text-xl font-bold tracking-tight text-zinc-900">
            {snapshot
              ? `${snapshot.persona?.name ?? snapshot.configuration} · ${snapshot.id.slice(0, 8)}`
              : "Start a session"}
          </h1>
          <span
            class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-50 text-zinc-700 border border-zinc-200/60"
            role="status">{snapshot?.status ?? client.connection}</span
          >
        </div>
        <p class="text-xs text-zinc-400 font-mono mt-1">
          {snapshot
            ? `${snapshot.workspace} • ${snapshot.model?.provider}/${snapshot.model?.id}`
            : "Sessions run on your backend host."}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-1.5 text-xs">
        <Button class={button} onclick={() => client.reconnect()}
          >Reconnect</Button
        >
        {#if snapshot}<Button class={button} onclick={() => client.stop()}
            >Stop / unload</Button
          >{/if}
        {#if snapshot && ["running", "cancelling"].includes(snapshot.status)}<Button
            class={button}
            onclick={() => client.cancel()}>Cancel and clear queue</Button
          >{/if}
      </div>
    </header>
    {#if !client.catalog.configurations.length}<p class="text-sm text-zinc-500">
        No model configured. Set PISPARK_CONFIG on the server; see
        docs/session-protocol.md. Persona resources do not configure providers
        or grant tools.
      </p>{/if}
    {#if snapshot?.persona}<p class="text-xs text-zinc-500">
        Admitted persona: {snapshot.persona.name} · {snapshot.persona.revision.slice(
          0,
          12,
        )}. Saved edits apply to new sessions only.
      </p>{/if}
    {#if snapshot?.interrupted}<p role="status" class="text-sm text-zinc-700">
        Work was interrupted or failed. No automatic replay is attempted.
      </p>{/if}
    {#if snapshot?.error}<p role="alert" class="text-sm text-zinc-700">
        Session error: {snapshot.error}. Stop / unload, then select this session
        again before continuing.
      </p>{/if}
    {#if snapshot}
      <p class="text-xs text-zinc-500">
        {client.connection} · Queued: {snapshot.queue.steering} steering, {snapshot
          .queue.followUp} follow-up
      </p>
      {#if (client.older?.before ?? snapshot.before) > 0}<Button
          class={button}
          onclick={() => client.history()}>Earlier messages</Button
        >{/if}
      {#if client.older}<section
          aria-label="Earlier message window"
          class="space-y-7"
        >
          <Button class={button} onclick={() => (client.older = undefined)}
            >Return to latest</Button
          >{#each client.older.messages as message}<NativeTurn
              {message}
            />{/each}
        </section>{/if}
      {#if snapshot.truncated || client.older?.truncated}<p
          class="text-xs text-zinc-500"
        >
          Content clipped for bounded display. Full native history remains on
          the backend; images and tool arguments are omitted.
        </p>{/if}
      <div class="space-y-7">
        {#each snapshot.messages as message}<NativeTurn
            {message}
          />{/each}{#if snapshot.partial}<NativeTurn
            message={snapshot.partial}
          />{/if}
      </div>
    {/if}
    <div class="h-10"></div>
  </div>
</main>
