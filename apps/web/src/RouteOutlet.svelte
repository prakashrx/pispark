<script lang="ts">
  import type { Page } from "./routes";
  import Conversation from "./features/workspace/Conversation.svelte";
  import Composer from "./features/workspace/Composer.svelte";
  import ProvidersPage from "./features/settings/providers/ProvidersPage.svelte";
  import GeneralSettings from "./features/settings/GeneralSettings.svelte";
  import PersonaPage from "./features/persona/PersonaPage.svelte";
  import Sources from "./features/sources/Sources.svelte";
  import { useSessions } from "./features/workspace/session-client.svelte";
  let { page }: { page: Page } = $props();
  const sessions = useSessions();
</script>

<div
  class={page === "workspace"
    ? "route-content workspace flex-1 flex flex-col min-h-0"
    : "route-content flex-1 flex flex-col min-h-0 text-foreground"}
>
  {#if page === "workspace"}
    <Conversation />
    {#if sessions.selected}<footer class="reply-dock px-6 pb-5 pt-2 flex flex-col items-center w-full z-10">
      <div class="w-full max-w-3xl relative">
        <Composer mode="reply" />
      </div>
    </footer>{/if}
  {:else if page === "providers"}
    <ProvidersPage />
  {:else if page === "settings"}
    <GeneralSettings />
  {:else if page === "persona"}
    <PersonaPage />
  {:else}
    <Sources />
  {/if}
</div>

<style>
  .reply-dock {
    background: linear-gradient(to bottom, transparent, var(--background) 1.25rem);
    margin-top: -1.25rem;
  }
</style>
