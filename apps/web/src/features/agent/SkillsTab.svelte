<script lang="ts">
  /**
   * Skills: know-how the agent loads only when a task matches what the skill says it's for. The
   * list, and the open skill with SKILL.md in the editor beside when it's used (its description,
   * what the agent decides from) and its other files, which open read-only in the same editor.
   */
  import Icon from "../../lib/ui/Icon.svelte";
  import { MarkdownEditor } from "../../lib/markdown";
  import TabIntro from "./TabIntro.svelte";
  import Split from "./Split.svelte";
  import DetailHead from "./DetailHead.svelte";
  import ItemText from "./ItemText.svelte";
  import Pane from "./Pane.svelte";
  import SaveBar from "./SaveBar.svelte";
  import DescriptionPane from "./DescriptionPane.svelte";
  import { isFresh, keyOf, type AgentPage, type Row } from "./agent-page.svelte";

  let { page, onai, narrow, stacked }: { page: AgentPage; onai?: () => void; narrow: boolean; stacked: boolean } = $props();

  const skills = $derived(page.rows("skills"));
  const open = $derived(page.opened("skills", narrow));
  $effect(() => {
    if (open && !isFresh(open)) void page.load(open);
  });
  // Another file of the skill, read-only in the same editor.
  let file = $state<{ key: string; path: string; text: string } | undefined>();
  async function showFile(item: Row, relative: string) {
    if (isFresh(item) || !item.path) return;
    const path = item.path.replace(/SKILL\.md$/, relative);
    try {
      const read = await page.client.readFile(path, page.client.fileTarget(item));
      file = { key: keyOf(item), path: relative, text: relative.endsWith(".md") ? read.text : "```\n" + read.text + "\n```" };
    } catch (error) {
      file = { key: keyOf(item), path: relative, text: `Couldn't read it: ${(error as Error).message}` };
    }
  }

  const files = (item: Row) => (isFresh(item) ? [] : (item.files ?? []));
  const fileCount = (item: Row) => (files(item).length ? `SKILL.md and ${files(item).length} more file${files(item).length > 1 ? "s" : ""}` : "SKILL.md");
</script>

<TabIntro {page} kind="skills" oncreate={() => { page.create("skills"); onai?.(); }}>Know-how the agent loads only when a task matches <em>Use when</em>.</TabIntro>

<Split items={skills} selected={open} {narrow} label="Skills" off={(item) => !isFresh(item) && !item.on} onselect={(item) => { file = undefined; page.show("skills", item); }}>
  {#snippet row(item)}
    <span class="split-name">{item.name || "New skill"}</span>
    <span class="split-desc">{isFresh(item) ? "Not saved yet" : item.unavailable ? "Unavailable: its files are missing." : (item.description ?? "")}</span>
  {/snippet}

  {#snippet detail()}
    {#if open}
      {@const item = open}
      <DetailHead {page} {item} about={fileCount(item)} entries={page.entries(item)} />
      <div class="panes" data-stack={stacked || narrow || undefined}>
        <Pane title={file?.key === keyOf(item) ? file.path : "SKILL.md"} area="doc">
          {#snippet action()}
            {#if file?.key === keyOf(item)}<button type="button" class="ui-button" data-variant="ghost" data-size="compact" onclick={() => (file = undefined)}>Back to SKILL.md</button>{/if}
          {/snippet}
          {#if file?.key === keyOf(item)}
            <MarkdownEditor value={file.text} label={file.path} editable={false} />
          {:else}
            <ItemText {page} {item} label="SKILL.md" frontmatter="hidden" placeholder="The steps, rules and examples the agent follows when it uses the skill." />
          {/if}
        </Pane>

        <DescriptionPane {page} {item} title="Use when" area="use" empty="Not set yet. The agent can't pick a skill without it." note="The agent sees only this until a task needs the skill." />

        {#if files(item).length}
          <Pane title="Files" area="files">
            <ul class="files">
              <li><button type="button" class="file" aria-current={!file || file.key !== keyOf(item) || undefined} onclick={() => (file = undefined)}><Icon name="file" class="h-3.5 w-3.5" />SKILL.md</button></li>
              {#each files(item) as path (path)}
                <li><button type="button" class="file" aria-current={(file?.key === keyOf(item) && file.path === path) || undefined} onclick={() => void showFile(item, path)}><Icon name={path.endsWith(".md") ? "file" : "code"} class="h-3.5 w-3.5" />{path}</button></li>
              {/each}
            </ul>
          </Pane>
        {/if}
      </div>
      <SaveBar {page} {item} />
    {/if}
  {/snippet}
</Split>

<style>
  /* Wide: SKILL.md on the left, when it's used and its files on the right. */
  .panes {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 16rem;
    grid-template-areas: "doc use" "doc files";
    grid-template-rows: auto 1fr;
    gap: 1rem 1.25rem;
    align-items: start;
  }
  /* One column: when it's used first (what the agent decides from), then the text, then files. */
  .panes[data-stack] {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "use" "doc" "files";
    grid-template-rows: none;
  }
  .files {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .file {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 1.75rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    text-align: left;
    overflow-wrap: anywhere;
  }
  .file:hover {
    color: var(--foreground);
    text-decoration: underline;
  }
  .file[aria-current] {
    color: var(--foreground);
    font-weight: 600;
  }
</style>
