<script lang="ts">
  import type { Page } from "./routes";
  import SessionArea from "./features/workspace/SessionArea.svelte";
  import NoChat from "./features/workspace/NoChat.svelte";
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
    <!-- Each chat gets its own host, so nothing of one chat's view leaks into the next. -->
    {#if sessions.current}{#key sessions.current.id}<SessionArea chat={sessions.current} />{/key}{:else}<NoChat />{/if}
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

