<script lang="ts">
  /**
   * Settings (set 6): its sections beside the open one where there's room; on a phone, the list
   * of sections, each opening as its own screen. Each section is a grid of cards.
   */
  import Icon from "../../lib/ui/Icon.svelte";
  import type { IconName } from "../../lib/ui/icons";
  import Screen from "../../shell/Screen.svelte";
  import { layout } from "../../shell/layout.svelte";
  import { href, settingsSections, type SettingsSection } from "../../routes";
  import AppearanceSettings from "./AppearanceSettings.svelte";
  import ProvidersPage from "./providers/ProvidersPage.svelte";
  import RemoteAccessPage from "../remote/RemoteAccessPage.svelte";
  import AboutPage from "../about/AboutPage.svelte";
  import { useSessions } from "../workspace/session-client.svelte";

  let { section }: { section?: SettingsSection } = $props();
  const sessions = useSessions();
  const compact = $derived(layout.size === "compact");
  const shown = $derived(section ?? "appearance");
  const sections = Object.entries(settingsSections) as [SettingsSection, (typeof settingsSections)[SettingsSection]][];
  const icons: Record<SettingsSection, IconName> = { appearance: "general", providers: "providers", remote: "globe", about: "info" };
</script>

{#snippet page(which: SettingsSection)}
  {#if which === "providers"}<ProvidersPage />
  {:else if which === "remote"}<RemoteAccessPage />
  {:else if which === "about"}<AboutPage />
  {:else}<AppearanceSettings />{/if}
{/snippet}

{#if compact && !section}
  <Screen title="Settings">
    <nav aria-label="Settings sections">
      {#each sections as [id, info] (id)}
        <a class="section-row" href={href({ name: "settings", section: id })}>
          <Icon name={icons[id]} class="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1">
            <span class="block font-medium">{info.label}</span>
            <span class="block text-sm text-muted-foreground">{info.hint}</span>
          </span>
          {#if id === "about" && sessions.host.ready}<span class="update">Update</span>{/if}
          <Icon name="chevronRight" class="h-4 w-4 text-muted-foreground" />
        </a>
      {/each}
    </nav>
  </Screen>
{:else if compact}
  <Screen title={settingsSections[shown].label} back={{ name: "settings" }}>
    <div class="cards">{@render page(shown)}</div>
  </Screen>
{:else}
  <Screen title="Settings" wide>
    <div class="split">
      <nav aria-label="Settings sections" class="sections">
        {#each sections as [id, info] (id)}
          <a class="nav-item" href={href({ name: "settings", section: id })} aria-current={shown === id ? "page" : undefined}
            ><Icon name={icons[id]} class="h-4 w-4 text-muted-foreground" /><span class="flex-1">{info.label}</span>{#if id === "about" && sessions.host.ready}<span class="update">Update</span>{/if}</a
          >
        {/each}
      </nav>
      <div class="cards">{@render page(shown)}</div>
    </div>
  </Screen>
{/if}

<style>
  .split {
    display: grid;
    grid-template-columns: 12.5rem minmax(0, 1fr);
    gap: 1.5rem;
    max-width: 62rem;
    margin: 0 auto;
  }
  /* Each card takes a column where there is room for two. */
  .cards {
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
    gap: 0.75rem;
    align-items: start;
  }
  .sections {
    position: sticky;
    top: 0;
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  @media (max-width: 839.98px) {
    .split {
      grid-template-columns: 11rem minmax(0, 1fr);
      gap: 1rem;
    }
    .cards {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .section-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 3.5rem;
    padding: 0.5rem 0.25rem;
    border-bottom: 1px solid var(--border);
  }
  .update {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--interactive-text);
  }
</style>
