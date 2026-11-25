<script lang="ts">
  /**
   * The top of anything opened in a tab (an instruction, skill, prompt or extension): its name, a
   * line about it, where it comes from, whether the agent uses it, and ⋯ for the rest. A new one
   * is named in place. One header for every tab, so they read the same. Without an item it's only
   * a title and a line (instructions' "Everything, in order").
   */
  import type { Snippet } from "svelte";
  import { tick } from "svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Menu from "../../lib/ui/Menu.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import BackButton from "./BackButton.svelte";
  import { isFresh, KINDS, NAME, type AgentPage, type Entry, type Kind, type Row } from "./agent-page.svelte";

  let {
    page,
    item,
    heading,
    title,
    about,
    entries = [],
    back,
  }: {
    page: AgentPage;
    item?: Row;
    /** The title when there's no item. */
    heading?: string;
    /** In place of the plain name (prompts show /name and their arguments). */
    title?: Snippet;
    about?: string;
    entries?: Entry[];
    /** A way back above the title (an extension's page). */
    back?: { label: string; onclick: () => void };
  } = $props();

  const one = $derived(item ? KINDS[item.type as Kind].one : "");
  const fresh = $derived(item && isFresh(item) ? item : undefined);
  let naming = $state(false);
  let name = $state("");
  let pencil: HTMLButtonElement | undefined = $state();
  let field: HTMLInputElement | undefined = $state();
  const valid = $derived(NAME.test(name.trim()));
  const hint = $props.id();

  async function startNaming() {
    name = fresh?.name ?? "";
    naming = true;
    await tick();
    field?.select();
  }
  async function done(keep: boolean) {
    if (fresh && keep && valid) page.rename(fresh, name.trim());
    naming = false;
    await tick();
    pencil?.focus();
  }
</script>

<header class="dhead">
  {#if back}<BackButton label={back.label} onclick={back.onclick} />{/if}
  <div class="head-row">
    <div class="who">
      <div class="name-row">
        {#if naming}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <form class="naming" onsubmit={(event) => { event.preventDefault(); void done(true); }} onkeydown={(event) => event.key === "Escape" && void done(false)}>
            <input bind:this={field} aria-label={`Name the ${one}`} aria-describedby={hint} bind:value={name} aria-invalid={(!!name && !valid) || undefined} onblur={() => void done(true)} autocomplete="off" spellcheck="false" />
            <span id={hint} class="hint">{name && !valid ? "Letters, numbers, dots, dashes; no spaces" : "Enter to keep, Esc to cancel"}</span>
          </form>
        {:else if title}
          <h2 tabindex="-1">{@render title()}</h2>
        {:else if item}
          <h2 tabindex="-1" class:placeholder={!item.name}>{item.name || `New ${one}`}</h2>
        {:else}
          <h2 tabindex="-1">{heading}</h2>
        {/if}
        {#if fresh && !naming}
          <button bind:this={pencil} type="button" class="ui-button" data-size="icon" aria-label={fresh.name ? "Rename" : "Name it"} title={fresh.name ? "Rename" : "Name it"} onclick={() => void startNaming()}><Icon name="pencil" class="h-3.5 w-3.5" /></button>
        {/if}
      </div>
      {#if about}<p class="about">{about}</p>{/if}
    </div>
    {#if item}
      <div class="acts">
        <span class="src">{page.source(item)}</span>
        {#if !isFresh(item)}
          <Toggle
            label={`Use ${item.name}`}
            checked={item.on}
            disabled={page.readOnly || page.client.busy}
            onchange={(event: Event) => void page.client.toggle(item.type, item.name, (event.currentTarget as HTMLInputElement).checked)}
          />
        {/if}
        {#if entries.length}
          <Menu label={`More for ${item.name || one}`} items={entries} />
        {/if}
      </div>
    {/if}
  </div>
</header>

<style>
  .dhead {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .head-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0.5rem 1rem;
  }
  .who {
    flex: 1 1 16rem;
    min-width: 0;
  }
  .name-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 2rem;
  }
  h2 {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
    font-size: var(--text-lg);
    font-weight: 650;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
    outline: none;
  }
  .placeholder {
    color: var(--subtle-foreground);
  }
  .naming {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .naming input {
    min-width: 12rem;
    padding: 0;
    border: 0;
    border-bottom: 2px solid var(--ring);
    background: transparent;
    font-size: var(--text-lg);
    font-weight: 650;
  }
  .naming input:focus {
    outline: none;
  }
  .naming input[aria-invalid] {
    border-bottom-color: var(--danger-foreground);
  }
  .hint {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .about {
    margin-top: 0.125rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-height: 2rem;
  }
  .src {
    font-size: var(--text-xs);
    color: var(--subtle-foreground);
  }
</style>
