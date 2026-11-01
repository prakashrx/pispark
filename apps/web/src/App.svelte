<script lang="ts">
  import { onMount, tick } from "svelte";
  import AppShell from "./lib/layout/AppShell.svelte";
  import RouteOutlet from "./RouteOutlet.svelte";
  import SessionSidebar from "./features/workspace/SessionSidebar.svelte";
  import SettingsSidebar from "./features/settings/SettingsSidebar.svelte";
  import { pageFromHash, routes } from "./routes";

  let page = $state(pageFromHash(window.location.hash));
  function focusMain() {
    const main = document.querySelector("main");
    main?.setAttribute("tabindex", "-1");
    main?.focus({ preventScroll: true });
  }
  onMount(() => {
    const navigate = async () => {
      page = pageFromHash(window.location.hash);
      await tick();
      document.documentElement.scrollTop = 0;
      focusMain();
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  });
</script>

<svelte:head><title>PiSpark — {routes[page].title}</title></svelte:head>
<a
  href="#workspace"
  onclick={(event) => {
    event.preventDefault();
    focusMain();
  }}
  class="skip-link text-xs">Skip to content</a
>
<AppShell>
  {#snippet sidebar()}
    {#if page === "workspace"}<SessionSidebar />{:else}<SettingsSidebar
        {page}
      />{/if}
  {/snippet}
  <RouteOutlet {page} />
</AppShell>
