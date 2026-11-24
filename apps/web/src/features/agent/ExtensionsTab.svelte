<script lang="ts">
  /**
   * Extensions: code that adds tools. PiSpark's own tools come first, as Built in; then each
   * extension with where it comes from and what it gives the agent. Opening one gives it the tab,
   * with the same header as the other tabs and a switch for every tool it gives. The tools are
   * found by loading the agent's extensions without a session; commands and views appear only
   * while a session runs, so they aren't listed here.
   */
  import { tick } from "svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import type { ResolvedItem, ResolvedTool } from "../../../../server/src/contract/agent-protocol";
  import TabIntro from "./TabIntro.svelte";
  import DetailHead from "./DetailHead.svelte";
  import Pane from "./Pane.svelte";
  import BackButton from "./BackButton.svelte";
  import { isFresh, keyOf, type AgentPage } from "./agent-page.svelte";

  let { page, onai }: { page: AgentPage; onai?: () => void } = $props();

  const BUILT_IN = "extensions/built-in";
  const exts = $derived(page.rows("extensions").filter((row): row is ResolvedItem => !isFresh(row)));
  const tools = $derived(page.view?.tools ?? []);
  const core = $derived(tools.filter((tool) => tool.source?.kind === "core"));
  const toolsOf = (name: string) => tools.filter((tool) => tool.source?.kind === "extension" && tool.source.name === name);
  const builtIn = $derived(page.open.extensions === BUILT_IN);
  const opened = $derived(builtIn ? undefined : page.opened("extensions", false));
  const item = $derived(opened && !isFresh(opened) ? opened : undefined);

  async function show(next: ResolvedItem | "built-in" | undefined) {
    const was = page.open.extensions;
    page.open.extensions = next === "built-in" ? BUILT_IN : next ? keyOf(next) : undefined;
    await tick();
    if (next) document.querySelector<HTMLElement>(".ext-page h2")?.focus();
    else if (was) document.querySelector<HTMLElement>(`.rows [data-key="${CSS.escape(was)}"]`)?.focus();
  }
  const from = (ext: ResolvedItem) =>
    ext.origin.id !== page.agent ? `From ${ext.origin.name}` : ext.reference?.startsWith("bundled:") ? "Comes with PiSpark" : ext.reference?.startsWith("shared:") ? "Shared library" : `This agent's folder · extensions/${ext.name}`;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const summary = (list: ResolvedTool[]) => {
    if (!list.length) return "Adds no tools";
    const on = list.filter((tool) => tool.on).length;
    return on < list.length ? `${on} of ${plural(list.length, "tool")} on` : plural(list.length, "tool");
  };
</script>

{#snippet toolList(list: ResolvedTool[])}
  <ul class="table">
    {#each list as tool (tool.name)}
      <li data-off={!tool.on || undefined}>
        <div class="text">
          <span class="tname">{tool.label ?? tool.name}{#if tool.label}<code>{tool.name}</code>{/if}</span>
          {#if tool.description}<span class="desc">{tool.description}</span>{/if}
          {#if tool.setBy && tool.setBy.id !== page.agent}<span class="desc">Set by {tool.setBy.name}</span>{/if}
        </div>
        <Toggle
          label={`${tool.label ?? tool.name} (${tool.name})`}
          checked={tool.on}
          disabled={page.readOnly || page.client.busy}
          onchange={(event: Event) => void page.client.toggle("tool", tool.name, (event.currentTarget as HTMLInputElement).checked)}
        />
      </li>
    {/each}
  </ul>
{/snippet}

{#if builtIn}
  <article class="ext-page">
    <BackButton label="Extensions" onclick={() => void show(undefined)} />
    <DetailHead {page} heading="Built in" about="What every PiSpark session can do: files, commands, sessions and schedules. Turn single tools off for {page.here}." />
    <Pane title="Tools it gives the agent" count={summary(core)}>{@render toolList(core)}</Pane>
  </article>
{:else if item}
  {@const mine = toolsOf(item.name)}
  <article class="ext-page">
    <DetailHead {page} {item} back={{ label: "Extensions", onclick: () => void show(undefined) }} about={item.unavailable ? "Unavailable: its files are missing." : item.description} entries={page.entries(item)} />
    <p class="source"><Icon name={item.reference?.startsWith("shared:") || item.reference?.startsWith("bundled:") ? "code" : "folder"} class="h-4 w-4" />{from(item)}</p>
    {#if mine.length}
      <Pane title="Tools it gives the agent" count={summary(mine)}>{@render toolList(mine)}</Pane>
    {:else}
      <p class="note">{page.view?.toolsIncomplete ? "Its tools couldn't be listed: the extension didn't load. A session of the agent shows why." : "It gives the agent no tools. It may add commands or views, which show while a session runs."}</p>
    {/if}
  </article>
{:else}
  <TabIntro {page} kind="extensions" oncreate={onai} createLabel="Build with AI">Code that adds tools, commands and views. Turn single tools off without removing the extension.</TabIntro>
  <ul class="rows">
    <li class="ext" data-builtin>
      <span class="tile" aria-hidden="true"><Icon name="code" class="h-4 w-4" /></span>
      <button type="button" class="open" data-key={BUILT_IN} onclick={() => void show("built-in")}>
        <span class="ename">Built in</span>
        <span class="edesc">Files, commands, sessions and schedules: what every PiSpark session can do.</span>
        <span class="meta">Part of PiSpark<span class="dot">·</span>{summary(core)}</span>
      </button>
    </li>
    {#each exts as ext (keyOf(ext))}
      <li class="ext" data-off={!ext.on || undefined}>
        <span class="tile" aria-hidden="true">{ext.name[0]?.toUpperCase()}</span>
        <button type="button" class="open" data-key={keyOf(ext)} onclick={() => void show(ext)}>
          <span class="ename">{ext.name}</span>
          {#if ext.description}<span class="edesc">{ext.description}</span>{/if}
          <span class="meta">{from(ext)}<span class="dot">·</span>{ext.unavailable ? "Unavailable" : summary(toolsOf(ext.name))}</span>
        </button>
        <Toggle
          label={`Use ${ext.name}`}
          checked={ext.on}
          disabled={page.readOnly || page.client.busy}
          onchange={(event: Event) => void page.client.toggle("extensions", ext.name, (event.currentTarget as HTMLInputElement).checked)}
        />
      </li>
    {/each}
  </ul>
  {#if page.view?.toolsIncomplete}<p class="note">Some extensions couldn't be loaded, so their tools aren't listed.</p>{/if}
{/if}

<style>
  .ext-page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 48rem;
  }
  .source {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.875rem;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--muted) 45%, transparent);
    font-size: var(--text-sm);
    color: var(--muted-foreground);
    overflow-wrap: anywhere;
  }
  .rows,
  .table {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--background);
    overflow: hidden;
  }
  .ext {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    padding: 0 1rem;
  }
  .ext + .ext {
    border-top: 1px solid var(--border);
  }
  .ext[data-builtin] {
    background: color-mix(in srgb, var(--muted) 35%, var(--background));
  }
  .tile {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius-sm);
    background: var(--chip);
    font-weight: 650;
    color: var(--muted-foreground);
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.0625rem;
    padding: 0.875rem 0;
    text-align: left;
  }
  .open:hover .ename {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .ename {
    font-size: var(--text-md);
    font-weight: 600;
  }
  .ext[data-off] .ename {
    color: var(--muted-foreground);
  }
  .edesc {
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .meta {
    font-size: var(--text-xs);
    color: var(--subtle-foreground);
  }
  .dot {
    margin: 0 0.375rem;
  }
  .table li {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.625rem 1rem;
  }
  .table li + li {
    border-top: 1px solid var(--border);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .tname {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
    font-size: var(--text-sm);
    font-weight: 500;
  }
  .tname code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--subtle-foreground);
  }
  [data-off] .tname {
    color: var(--muted-foreground);
  }
  .desc {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .note {
    margin-top: 0.75rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
</style>
