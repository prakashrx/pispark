<script lang="ts">
  import type { Page } from "./routes";
  import Conversation from "./features/workspace/Conversation.svelte";
  import Composer from "./features/workspace/Composer.svelte";
  import ProvidersPage from "./features/settings/providers/ProvidersPage.svelte";
  import GeneralSettings from "./features/settings/GeneralSettings.svelte";
  import PersonaPage from "./features/persona/PersonaPage.svelte";
  import Sources from "./features/sources/Sources.svelte";
  let { page }: { page: Page } = $props();
</script>

<div
  class={page === "workspace"
    ? "route-content workspace flex-1 flex flex-col min-h-0"
    : "route-content flex-1 flex flex-col min-h-0 text-[#111827] selection:bg-neutral-100"}
>
  {#if page === "workspace"}
    <Conversation />
    <footer class="p-6 pt-0 bg-transparent flex justify-center w-full z-10">
      <div class="w-full max-w-4xl relative">
        <Composer mode="reply" />
      </div>
    </footer>
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
