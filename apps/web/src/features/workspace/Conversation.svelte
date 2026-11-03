<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import NativeTurn from "./NativeTurn.svelte";
  import ChatDetails from "./ChatDetails.svelte";
  import { chatName, chatStatus } from "./chat-presentation";
  import { useSessions } from "./session-client.svelte";
  const client = useSessions();
  const snapshot = $derived(client.snapshot);
  const chat = $derived(
    snapshot ?? client.sessions.find((s) => s.id === client.selected),
  );
  const status = $derived(
    client.connection === "Connecting" || client.connection === "Loading"
      ? "Opening…"
      : chatStatus(chat?.status, chat?.interrupted),
  );
  const queued = $derived(
    (snapshot?.queue.steering ?? 0) + (snapshot?.queue.followUp ?? 0),
  );
  const modelName = $derived(
    client.providers.catalog.providers
      .find((p) => p.id === snapshot?.model?.provider)
      ?.models.find((m) => m.id === snapshot?.model?.id)?.name,
  );
  const button =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-700 bg-white hover:bg-zinc-50 border border-zinc-200 shadow-elevation-sm";
</script>

<main
  id="workspace"
  aria-label="Chat conversation"
  class="flex-1 overflow-y-auto px-6 py-8 flex flex-col items-center"
>
  <div class="w-full max-w-4xl flex flex-col space-y-8">
    <header class="pb-4 border-b border-zinc-100 space-y-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-3 flex-wrap">
            <h1
              class="text-xl font-bold tracking-tight text-zinc-900 break-words"
            >
              {chat ? chatName(chat) : "Start a chat"}
            </h1>
            {#if status}<span role="status" class="text-xs text-zinc-500"
                >{status}</span
              >{/if}
          </div>
          {#if chat}<p class="text-xs text-zinc-400 mt-1">
              {[
                chat.persona?.name,
                client.catalog.workspaces.find(
                  (w) => w.value === chat.workspace,
                )?.label ?? chat.workspace,
                modelName,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>{:else}<p class="text-xs text-zinc-400 mt-1">
              Ask a question above to get started.
            </p>{/if}
        </div>
        {#if snapshot && ["running", "cancelling"].includes(snapshot.status)}<Button
            class={button}
            aria-label="Stop response"
            onclick={() => client.cancel()}>Stop</Button
          >{/if}
      </div>
      <ChatDetails />
    </header>
    {#if chat && client.connection === "Disconnected"}<p
        role="alert"
        class="text-sm text-zinc-700"
      >
        Connection lost. Your chat may still be running. <Button
          class={button}
          onclick={() => client.reconnect()}>Reconnect</Button
        >
      </p>
    {:else if chat && client.connection === "Reconnecting"}<p
        role="status"
        class="text-sm text-zinc-500"
      >
        Reconnecting…
      </p>{/if}
    {#if !client.catalog.configurations.length}<div
        class="text-sm text-zinc-500"
      >
        <p>This workspace isn’t ready for chats yet.</p>
        <details class="text-xs mt-2">
          <summary>Details</summary>
          <p>
            A working folder and chat setup must be configured on the backend
            host.
          </p>
        </details>
      </div>{/if}
    {#if snapshot?.interrupted}<p role="status" class="text-sm text-zinc-700">
        This chat was interrupted. Your saved messages are still here.
      </p>{/if}
    {#if snapshot?.error}<p role="alert" class="text-sm text-zinc-700">
        Something went wrong. Reopen this chat to try again.
      </p>{/if}
    {#if snapshot}
      {#if queued > 0}<p class="text-xs text-zinc-500">
          {queued} messages queued
        </p>{/if}
      {#if (client.older?.before ?? snapshot.before) > 0}<Button
          class={button}
          onclick={() => client.history()}>Load earlier messages</Button
        >{/if}
      {#if client.older}<section
          aria-label="Earlier message window"
          class="space-y-7"
        >
          <Button class={button} onclick={() => (client.older = undefined)}
            >Back to latest</Button
          >{#each client.older.messages as message}<NativeTurn
              {message}
            />{/each}
        </section>{/if}
      {#if snapshot.truncated || client.older?.truncated}<p
          class="text-xs text-zinc-500"
        >
          Some content isn’t shown in this view.
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
