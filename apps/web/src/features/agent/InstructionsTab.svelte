<script lang="ts">
  /**
   * Instructions: what the agent reads at the start of every session, top to bottom. The list in
   * reading order, the open one in the editor. The first row opens everything at once, as the
   * agent reads it, with each part's share.
   */
  import { MarkdownEditor } from "../../lib/markdown";
  import ItemText from "./ItemText.svelte";
  import TabIntro from "./TabIntro.svelte";
  import Split from "./Split.svelte";
  import DetailHead from "./DetailHead.svelte";
  import SaveBar from "./SaveBar.svelte";
  import { isFresh, keyOf, words, type AgentPage, type Row } from "./agent-page.svelte";

  let { page, narrow, name }: { page: AgentPage; narrow: boolean; name: string } = $props();

  const all = $derived(page.rows("instructions"));
  // Read in this order; what's off comes last and isn't read.
  const used = $derived(all.filter((item) => isFresh(item) || item.on));
  $effect(() => {
    for (const item of all) if (!isFresh(item)) void page.load(item);
  });
  const size = (item: Row) => Math.max(1, words(page.draft(item)));
  const total = $derived(used.reduce((n, item) => n + size(item), 0));
  const whole = $derived(used.map((item) => page.draft(item).trim()).filter(Boolean).join("\n\n"));
  const everything = $derived(page.open.instructions === "all");
  const open = $derived(page.opened("instructions", narrow));
  const share = (n: number) => `${Math.round((n / Math.max(total, 1)) * 100)}%`;
  const own = (item: Row) => page.owns(item);

  const entries = (item: Row) =>
    isFresh(item)
      ? []
      : page.entries(item, [
          ...(page.movable(item, -1) ? [{ id: "up", label: "Move up", onselect: () => void page.move(item, -1) }] : []),
          ...(page.movable(item, 1) ? [{ id: "down", label: "Move down", onselect: () => void page.move(item, 1) }] : []),
        ]);
</script>

<TabIntro {page} kind="instructions" oncreate={() => page.create("instructions")}>What {name} reads at the start of every session, top to bottom. Later parts win when they disagree.</TabIntro>

<Split items={all} selected={open} showing={everything || !!open} {narrow} label="Instructions" onselect={(item) => page.show("instructions", item)} off={(item) => !isFresh(item) && !item.on}>
  {#snippet top()}
    {#if used.length}
      <li class="everything">
        <button type="button" class="split-row" aria-current={everything || undefined} onclick={() => page.show("instructions", "all")}>
          <span class="split-name">Everything, in order</span>
          <span class="split-desc">About {total} words, read every session</span>
          <span class="bar" aria-hidden="true">
            {#each used as item (keyOf(item))}<span class="seg" style:flex={size(item)} style:--o={own(item) ? 1 : 0.45}></span>{/each}
          </span>
        </button>
      </li>
    {/if}
  {/snippet}

  {#snippet row(item)}
    {@const n = used.indexOf(item)}
    <span class="top-line">
      {#if n >= 0}<span class="n" aria-hidden="true">{n + 1}</span>{:else}<span class="off">Off</span>{/if}
      <span class="split-name">{item.name || "New instruction"}</span>
    </span>
    <span class="split-desc">{isFresh(item) ? "Not saved yet" : `${page.source(item)} · ${size(item)} words`}</span>
  {/snippet}

  {#snippet detail()}
    {#if everything}
      <DetailHead {page} heading="Everything, in order" about={`What ${name} reads at the start of every session: about ${total} words.`} />
      <ol class="parts" aria-label="Parts, in reading order">
        {#each used as item, i (keyOf(item))}
          <li>
            <span class="swatch" style:--o={own(item) ? 1 : 0.45} aria-hidden="true"></span>
            <button type="button" class="part" onclick={() => page.show("instructions", item)}>{i + 1}. {item.name || "New instruction"}</button>
            <span class="share">{size(item)} words · {share(size(item))}</span>
          </li>
        {/each}
      </ol>
      <MarkdownEditor value={whole} label="All instructions, in order" editable={false} />
    {:else if open}
      {@const item = open}
      {@const n = used.indexOf(item)}
      <DetailHead {page} {item} about={n >= 0 ? `Part ${n + 1} of ${used.length} · ${size(item)} words, read every session` : "Turned off: the agent doesn't read it."} entries={entries(item)} />
      <ItemText {page} {item} label={item.name || "New instruction"} placeholder="Write how the agent should behave in every session: tone, rules, what to check." />
      <SaveBar {page} {item} />
    {/if}
  {/snippet}
</Split>

<style>
  .everything {
    margin-bottom: 0.25rem;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  .top-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .n {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 1.125rem;
    height: 1.125rem;
    border-radius: 50%;
    background: var(--muted);
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--muted-foreground);
  }
  .off {
    padding: 0 0.3125rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    font-size: var(--text-2xs);
    color: var(--muted-foreground);
  }
  .bar {
    display: flex;
    gap: 2px;
    width: 100%;
    height: 0.375rem;
    margin-top: 0.375rem;
    border-radius: var(--radius-full);
    overflow: hidden;
  }
  .seg,
  .swatch {
    background: color-mix(in srgb, var(--accent-fill) calc(var(--o) * 100%), var(--muted));
  }
  .parts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem 1.25rem;
  }
  .parts li {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: var(--text-sm);
  }
  .swatch {
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 3px;
  }
  .part:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .share {
    font-size: var(--text-xs);
    color: var(--subtle-foreground);
  }
</style>
