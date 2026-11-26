<script lang="ts">
  import type { Component } from "svelte";

  /** What the agent keeps for this place. Now: what waits on the person and what's in progress. Notes and History behind tabs. */
  type Question = { id: string; text: string; detail: string; answer?: string };
  type Snapshot = {
    waiting: Question[];
    doing: string;
    todo: string;
    done: string;
    notes: string;
    pages: { name: string; title: string; summary: string }[];
    skills: { name: string; description: string }[];
    changes: { id: string; label: string; at: string; created: boolean }[];
    problems: string[];
    weight: number;
  };
  type Host = { call: (name: string, data?: unknown) => Promise<unknown>; Markdown: Component<{ text: string }> };
  type Session = { setDraft?: (text: string) => void; showView?: (key?: string) => void };
  let { snapshot, host, session }: { snapshot?: Snapshot; host: Host; session?: Session } = $props();

  const TABS = [
    ["now", "Now"],
    ["notes", "Notes"],
    ["history", "History"],
  ] as const;
  type Tab = (typeof TABS)[number][0];
  let tab = $state<Tab>("now");
  let busy = $state<string | undefined>();
  let error = $state<string | undefined>();
  let notice = $state<string | undefined>();
  let pages = $state<Record<string, string>>({});
  let allChanges = $state(false);

  /** Runs one of the person's actions; `after` gets what it returned. */
  async function act(key: string, name: string, data?: unknown, after?: (result: unknown) => void) {
    busy = key;
    error = undefined;
    notice = undefined;
    try {
      after?.(await host.call(name, data));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = undefined;
    }
  }
  /** An answer takes the question off the list, so focus goes to the panel's first heading. */
  function settle(event: Event) {
    const heading = (event.currentTarget as HTMLElement).closest("[role=tabpanel]")?.querySelector("h2");
    return () => (heading as HTMLElement | null)?.focus();
  }
  const answer = (q: Question, text: string, event: Event) => void act(q.id, "answer", { id: q.id, text }, settle(event));
  const later = (q: Question, event: Event) => void act(q.id, "later", { id: q.id }, settle(event));
  /** Talk it over in the conversation: the question goes into the reply box, and it keeps waiting meanwhile. */
  function discuss(q: Question) {
    void act(q.id, "later", { id: q.id }, () => {
      session?.setDraft?.(`About "${headline(q.text)}": `);
      session?.showView?.();
    });
  }
  async function openPage(name: string, event: Event) {
    if (!(event.currentTarget as HTMLDetailsElement).open || pages[name] !== undefined) return;
    await act(`page:${name}`, "page", { name }, (text) => (pages[name] = String(text)));
  }
  /** Arrow keys move between tabs, as in any tab list. */
  function onTabKey(event: KeyboardEvent) {
    const at = TABS.findIndex(([key]) => key === tab);
    const to = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -2;
    if (to === -2) return;
    event.preventDefault();
    tab = TABS[(to + TABS.length) % TABS.length]![0];
    queueMicrotask(() => document.getElementById(`mind-tab-${tab}`)?.focus());
  }
  const plain = (text: string) => text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  /** Just the question: its bold part, else up to its question mark. */
  function headline(text: string): string {
    const bold = /\*\*(.+?)\*\*/.exec(text)?.[1];
    if (bold) return plain(bold);
    const said = plain(text);
    const mark = said.indexOf("?");
    return mark > 0 && mark < 200 ? said.slice(0, mark + 1) : said;
  }
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const open = $derived(snapshot?.waiting.filter((q) => q.answer === undefined) ?? []);
  const answered = $derived(snapshot?.waiting.filter((q) => q.answer !== undefined) ?? []);
</script>

<div class="mind">
  {#if !snapshot}
    <p class="quiet">Loading…</p>
  {:else}
    <div class="tabs" role="tablist" aria-label="Mind">
      {#each TABS as [key, label]}
        <button
          type="button"
          role="tab"
          id={`mind-tab-${key}`}
          aria-selected={tab === key}
          aria-controls={`mind-panel-${key}`}
          tabindex={tab === key ? 0 : -1}
          onclick={() => (tab = key)}
          onkeydown={onTabKey}
        >
          {label}{#if key === "now" && open.length}<span class="count" aria-hidden="true">{open.length}</span><span class="hidden">({open.length} waiting on you)</span>{/if}
        </button>
      {/each}
    </div>

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if notice}<p class="quiet" role="status">{notice}</p>{/if}

    {#if tab === "now"}
      <div class="panel" role="tabpanel" id="mind-panel-now" aria-labelledby="mind-tab-now">
        {#if snapshot.problems.length}
          <section aria-labelledby="mind-problems">
            <h2 id="mind-problems" tabindex="-1">Out of shape</h2>
            <ul class="plain">{#each snapshot.problems as problem}<li>{problem}</li>{/each}</ul>
            <p class="quiet">The agent is told to fix these at its next run.</p>
          </section>
        {/if}

        <section aria-labelledby="mind-waiting">
          <h2 id="mind-waiting" tabindex="-1">Waiting on you</h2>
          {#if open.length}
            <ul class="list">
              {#each open as q (q.id)}
                <li class="card">
                  <div class="doc"><host.Markdown text={q.text} /></div>
                  {#if q.detail}<div class="doc quiet"><host.Markdown text={q.detail} /></div>{/if}
                  <div class="actions">
                    <button type="button" class="primary" disabled={busy === q.id} onclick={(e) => answer(q, "Yes, do as you recommend.", e)}>Do it</button>
                    <button type="button" disabled={busy === q.id} onclick={(e) => answer(q, "No, don't.", e)}>No</button>
                    <button type="button" disabled={busy === q.id} onclick={(e) => later(q, e)}>Later</button>
                    <button type="button" disabled={busy === q.id} onclick={() => discuss(q)}>Discuss</button>
                  </div>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="quiet">Nothing. The agent leaves questions here and carries on meanwhile.</p>
          {/if}
          {#each answered as q (q.id)}
            <p class="quiet">Answered, for the agent to act on: {plain(q.text)} <em>{q.answer}</em></p>
          {/each}
        </section>

        <section aria-labelledby="mind-doing">
          <h2 id="mind-doing" tabindex="-1">Doing</h2>
          {#if snapshot.doing}<div class="doc"><host.Markdown text={snapshot.doing} /></div>{:else}<p class="quiet">Nothing in progress.</p>{/if}
        </section>

        {#if snapshot.todo}
          <section aria-labelledby="mind-todo">
            <h2 id="mind-todo" tabindex="-1">To do</h2>
            <div class="doc"><host.Markdown text={snapshot.todo} /></div>
          </section>
        {/if}
      </div>
    {:else if tab === "notes"}
      <div class="panel" role="tabpanel" id="mind-panel-notes" aria-labelledby="mind-tab-notes">
        <section aria-labelledby="mind-notes">
          <h2 id="mind-notes" tabindex="-1">Notes</h2>
          {#if snapshot.notes}<div class="doc"><host.Markdown text={snapshot.notes} /></div>{:else}<p class="quiet">Not written yet. The agent writes what it learns about this place here.</p>{/if}
          {#each snapshot.pages as page (page.name)}
            <details ontoggle={(e) => openPage(page.name, e)}>
              <summary>{page.title || page.name} <span class="quiet">{page.summary}</span></summary>
              {#if pages[page.name] !== undefined}<div class="doc"><host.Markdown text={pages[page.name]!} /></div>{:else}<p class="quiet">Loading…</p>{/if}
            </details>
          {/each}
        </section>
        {#if snapshot.skills.length}
          <section aria-labelledby="mind-skills">
            <h2 id="mind-skills" tabindex="-1">Skills</h2>
            <ul class="plain">{#each snapshot.skills as skill (skill.name)}<li><strong>{skill.name}</strong> <span class="quiet">{skill.description}</span></li>{/each}</ul>
          </section>
        {/if}
      </div>
    {:else}
      <div class="panel" role="tabpanel" id="mind-panel-history" aria-labelledby="mind-tab-history">
        <section aria-labelledby="mind-done">
          <h2 id="mind-done" tabindex="-1">Done lately</h2>
          {#if snapshot.done}<div class="doc"><host.Markdown text={snapshot.done} /></div>{:else}<p class="quiet">Nothing yet.</p>{/if}
        </section>

        {#if snapshot.changes.length}
          <section aria-labelledby="mind-changes">
            <h2 id="mind-changes" tabindex="-1">Changed lately</h2>
            <ul class="list">
              {#each allChanges ? snapshot.changes : snapshot.changes.slice(0, 6) as change (change.id)}
                <li class="row">
                  <span>{change.label} <span class="quiet">{change.created ? "created" : "changed"} {when(change.at)}</span></span>
                  <button type="button" class="subtle" disabled={busy === change.id} aria-label={`Undo the change to ${change.label} of ${when(change.at)}`} onclick={() => act(change.id, "undo", { id: change.id }, (label) => (notice = `${label} was put back as it was before that change.`))}>Undo</button>
                </li>
              {/each}
            </ul>
            {#if !allChanges && snapshot.changes.length > 6}
              <div><button type="button" class="subtle" onclick={() => (allChanges = true)}>Show {snapshot.changes.length - 6} more</button></div>
            {/if}
          </section>
        {/if}

        <section aria-labelledby="mind-tidy">
          <h2 id="mind-tidy" tabindex="-1">Tidy</h2>
          <p class="quiet">About {snapshot.weight.toLocaleString()} tokens are read at the start of every run. Tidying checks the notes against how things are, clears what's stale and tells you only what needs you.</p>
          <div class="actions">
            <button type="button" disabled={busy === "tidy"} onclick={() => act("tidy", "tidy", undefined, () => (notice = "Tidying started in the conversation."))}>Tidy now</button>
            <button type="button" disabled={busy === "weekly"} onclick={() => act("weekly", "weekly", undefined, (text) => (notice = String(text)))}>Tidy every week…</button>
          </div>
        </section>
      </div>
    {/if}
  {/if}
</div>

<style>
  .mind {
    max-width: 46rem;
    margin: 0 auto;
    padding: 1rem 1rem 3rem;
    color: var(--foreground);
    font-family: var(--font-sans);
    display: grid;
    gap: 1.25rem;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--border);
  }
  [role="tab"] {
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: transparent;
    padding: 0.45rem 0.8rem;
    color: var(--muted-foreground);
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  [role="tab"][aria-selected="true"] {
    color: var(--foreground);
    border-bottom-color: var(--accent-fill);
  }
  [role="tab"]:hover:not([aria-selected="true"]) {
    background: transparent;
    color: var(--foreground);
  }
  .count {
    font-size: 0.72rem;
    font-weight: 600;
    min-width: 1.15rem;
    padding: 0 0.3rem;
    border-radius: var(--radius-full);
    background: var(--accent-fill);
    color: var(--accent-on-fill);
    text-align: center;
  }
  .hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .panel {
    display: grid;
    gap: 1.6rem;
  }
  section {
    display: grid;
    gap: 0.6rem;
  }
  h2 {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0;
  }
  p {
    margin: 0;
    line-height: 1.45;
  }
  .quiet {
    color: var(--muted-foreground);
    font-size: 0.85rem;
    font-weight: 400;
  }
  .error {
    color: var(--danger);
    font-size: 0.9rem;
  }
  .doc {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* A document's own headings sit under this view's. */
  .mind .doc :global(h1),
  .mind .doc :global(h2),
  .mind .doc :global(h3) {
    font-size: 0.9rem;
    font-weight: 600;
    margin: 0.7rem 0 0.2rem;
  }
  .mind .doc :global(:first-child) {
    margin-top: 0;
  }
  .list,
  .plain {
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .list {
    list-style: none;
  }
  .plain {
    padding-left: 1.1rem;
  }
  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.7rem 0.8rem;
    display: grid;
    gap: 0.5rem;
  }
  .row {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    justify-content: space-between;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  details {
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
  }
  summary {
    cursor: pointer;
    font-weight: 500;
  }
  button {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--foreground);
    cursor: pointer;
    flex-shrink: 0;
  }
  button:hover:not(:disabled) {
    background: var(--interactive-hover);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .primary {
    background: var(--accent-fill);
    border-color: transparent;
    color: var(--accent-on-fill);
  }
  .primary:hover:not(:disabled) {
    background: var(--accent-fill);
    filter: brightness(1.08);
  }
  .subtle {
    border-color: transparent;
    color: var(--muted-foreground);
  }
  button:focus-visible,
  summary:focus-visible,
  h2:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
</style>
