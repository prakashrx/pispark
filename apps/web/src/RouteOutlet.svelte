<script lang="ts">
  import type { Page } from "./routes";
  import SessionArea from "./features/workspace/SessionArea.svelte";
  import NoSession from "./features/workspace/NoSession.svelte";
  import ProvidersPage from "./features/settings/providers/ProvidersPage.svelte";
  import GeneralSettings from "./features/settings/GeneralSettings.svelte";
  import AgentPage from "./features/agent/AgentPage.svelte";
  import Sources from "./features/sources/Sources.svelte";
  import SchedulesPage from "./features/schedules/SchedulesPage.svelte";
  import AboutPage from "./features/about/AboutPage.svelte";
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
    <!-- Each session gets its own host, so nothing of one session's view leaks into the next. -->
    {#if sessions.current}{#key sessions.current.id}<SessionArea session={sessions.current} />{/key}{:else}<NoSession />{/if}
  {:else if page === "providers"}
    <ProvidersPage />
  {:else if page === "settings"}
    <GeneralSettings />
  {:else if page === "agent"}
    <AgentPage />
  {:else if page === "schedules"}
    <SchedulesPage />
  {:else if page === "about"}
    <AboutPage />
  {:else}
    <Sources />
  {/if}
</div>

