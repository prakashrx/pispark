<script lang="ts">
  /**
   * Prompts: requests you type as /name. The list reads like the message box's slash picker. The
   * open prompt shows its template beside a preview: fill in the arguments the way you'd type them
   * and see the message it sends.
   */
  import { MarkdownEditor } from "../../lib/markdown";
  import TabIntro from "./TabIntro.svelte";
  import Split from "./Split.svelte";
  import DetailHead, { type Entry } from "./DetailHead.svelte";
  import Pane from "./Pane.svelte";
  import LockedNote from "./LockedNote.svelte";
  import DescriptionPane from "./DescriptionPane.svelte";
  import SaveBar from "./SaveBar.svelte";
  import { argumentNames, fieldOf } from "./frontmatter";
  import { isFresh, keyOf, type AgentPage, type Row } from "./agent-page.svelte";

  let { page, narrow, stacked }: { page: AgentPage; narrow: boolean; stacked: boolean } = $props();

  const prompts = $derived(page.rows("prompts"));
  const open = $derived(page.opened("prompts", narrow));
  $effect(() => {
    if (open && !isFresh(open)) void page.load(open);
  });
  let tries = $state<Record<string, string[]>>({});

  const body = (item: Row) => page.draft(item).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  /** $1, $2 … used in the template, named from its argument hint where it has one. */
  function argsOf(item: Row) {
    const names = argumentNames(fieldOf(page.draft(item), "argument-hint"));
    const used = [...new Set([...body(item).matchAll(/\$\{?(\d)/g)].map((m) => Number(m[1])))].sort();
    return used.map((n) => ({ n, name: names[n - 1] ?? `argument ${n}` }));
  }
  /** What it sends with the arguments typed so far; empty ones show their name. */
  function filled(item: Row) {
    const values = tries[keyOf(item)] ?? [];
    const value = (n: number) => values[n - 1]?.trim();
    return body(item)
      .replace(/\$\{(\d):-([^}]*)\}/g, (_, n: string, fallback: string) => (value(Number(n)) ? `**${value(Number(n))}**` : fallback))
      .replace(/\$(?:@|ARGUMENTS)/g, () => values.filter(Boolean).join(" ") || "‹arguments›")
      .replace(/\$(\d)/g, (_, n: string) => (value(Number(n)) ? `**${value(Number(n))}**` : `‹${argsOf(item).find((a) => a.n === Number(n))?.name ?? `argument ${n}`}›`));
  }
  function entries(item: Row): Entry[] {
    if (isFresh(item)) return [];
    const list: Entry[] = [];
    if (page.owns(item) && !page.readOnly) list.push({ id: "promote", label: "Move to Shared library", onselect: () => void page.promote(item) });
    if (!page.owns(item) && !page.readOnly) list.push({ id: "own", label: "Make it this agent's own", onselect: () => void page.makeOwn(item) });
    const how = page.removable(item);
    if (how) list.push({ id: "remove", label: how === "delete" ? "Delete prompt" : "Remove from this agent", destructive: true, onselect: () => void page.remove(item) });
    return list;
  }
</script>

{#snippet slash(item: Row)}<span class="cmd">/{item.name || "new-prompt"}</span>{#each argsOf(item) as a (a.n)}<span class="arg">‹{a.name}›</span>{/each}{/snippet}

<TabIntro {page} kind="prompts" oncreate={() => page.create("prompts")}>Type <kbd>/</kbd> in the message box to run one. What you type after the name fills in <code>$1</code>, <code>$2</code>…</TabIntro>

<Split items={prompts} selected={open} {narrow} label="Prompts" off={(item) => !isFresh(item) && !item.on} onselect={(item) => page.show("prompts", item)}>
  {#snippet row(item)}
    <span class="split-name slash">{@render slash(item)}</span>
    <span class="split-desc">{isFresh(item) ? "Not saved yet" : (item.description ?? "")}</span>
  {/snippet}

  {#snippet detail()}
    {#if open}
      {@const item = open}
      {@const text = page.text(item)}
      <DetailHead {page} {item} entries={entries(item)}>
        {#snippet title()}{#if isFresh(item) && !item.name}<span class="placeholder">New prompt</span>{:else}{@render slash(item)}{/if}{/snippet}
      </DetailHead>
      {#if isFresh(item) && !item.name}<p class="note">Name it with the pencil above; the name is what you type after <code>/</code>.</p>{/if}
      <DescriptionPane {page} {item} title="What it's for" empty="Not set yet. The slash picker shows this beside /name." />
      <div class="panes" data-stack={stacked || narrow || undefined}>
        <Pane title="Template">
          {#if text?.loading}<p class="note" role="status">Loading…</p>
          {:else if text?.error}<p class="note" role="alert">{text.error}</p>
          {:else}
            {#key keyOf(item)}
              <MarkdownEditor
                value={page.draft(item)}
                onchange={(next) => page.setDraft(item, next)}
                label={`/${item.name || "new-prompt"} template`}
                editable={page.editable(item)}
                mode={isFresh(item) ? "edit" : "preview"}
                frontmatter="hidden"
                placeholder="What /name sends. Use $1, $2 for what's typed after it."
              />
            {/key}
          {/if}
          {#if argsOf(item).length}
            <p class="note">{#each argsOf(item) as a, i (a.n)}{i ? " · " : ""}<code>${a.n}</code> is {a.name}{/each}</p>
          {/if}
          <LockedNote {page} {item} />
        </Pane>

        <Pane title="Preview">
          <div class="typed" role="group" aria-label="As you'd type it">
            <span class="cmd">/{item.name || "name"}</span>
            {#each argsOf(item) as a, i (a.n)}
              <input
                class="try-arg"
                aria-label={a.name}
                placeholder={a.name}
                value={tries[keyOf(item)]?.[a.n - 1] ?? ""}
                oninput={(event) => {
                  const values = (tries[keyOf(item)] ??= []);
                  values[a.n - 1] = event.currentTarget.value;
                }}
              />
            {/each}
          </div>
          <MarkdownEditor value={filled(item)} label="The message it sends" editable={false} tone="quiet" />
        </Pane>
      </div>
      <SaveBar {page} {item} />
    {/if}
  {/snippet}
</Split>

<style>
  .slash {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
  .cmd {
    font-family: var(--font-mono);
    color: var(--accent-text);
    font-weight: 600;
  }
  .arg {
    font-family: var(--font-mono);
    font-weight: 400;
    color: var(--muted-foreground);
  }
  .placeholder {
    color: var(--subtle-foreground);
  }
  .note {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .note code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    padding: 0 0.3rem;
    border-radius: var(--radius-sm);
    background: var(--muted);
    color: var(--foreground);
  }
  .panes {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 1rem 1.25rem;
    align-items: start;
  }
  .panes[data-stack] {
    grid-template-columns: minmax(0, 1fr);
  }
  .typed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--background);
    font-size: var(--text-sm);
  }
  .try-arg {
    width: 8.5rem;
    min-width: 0;
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--muted) 40%, transparent);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .try-arg:focus-visible {
    outline: none;
    border-color: var(--ring);
    background: var(--background);
  }
</style>
