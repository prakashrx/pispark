<script lang="ts">
  import type { Component } from "svelte";

  /** What the agent keeps for this place: what waits on the person first, then its tasks, notes, skills and recent changes. */
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
  };
  type Host = { call: (name: string, data?: unknown) => Promise<unknown>; Markdown: Component<{ text: string }> };
  let { snapshot, host }: { snapshot?: Snapshot; host: Host } = $props();

  const AS_RECOMMENDED = "Yes, do as you recommend.";
  const NO = "No, don't.";

  let busy = $state<string | undefined>();
  let error = $state<string | undefined>();
  let notice = $state<string | undefined>();
  let own = $state<Record<string, string>>({});
  let pages = $state<Record<string, string>>({});

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
  /** Answers a question; it leaves the list, so focus goes to the section's heading. */
  function answer(question: Question, text: string, event: Event) {
    const heading = (event.currentTarget as HTMLElement).closest("section")?.querySelector("h2");
    void act(question.id, "answer", { id: question.id, text }, () => heading?.focus());
  }
  async function openPage(name: string, event: Event) {
    if (!(event.currentTarget as HTMLDetailsElement).open || pages[name] !== undefined) return;
    await act(`page:${name}`, "page", { name }, (text) => (pages[name] = String(text)));
  }
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const open = $derived(snapshot?.waiting.filter((q) => q.answer === undefined) ?? []);
  const answered = $derived(snapshot?.waiting.filter((q) => q.answer !== undefined) ?? []);
  const empty = $derived(!!snapshot && !snapshot.notes && !snapshot.waiting.length && !snapshot.doing && !snapshot.todo && !snapshot.done && !snapshot.skills.length);
</script>

<div class="mind">
  {#if !snapshot}
    <p class="quiet">Loading…</p>
  {:else}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if notice}<p class="quiet" role="status">{notice}</p>{/if}

    {#if snapshot.problems.length}
      <section aria-labelledby="mind-problems">
        <h2 id="mind-problems" tabindex="-1">Out of shape</h2>
        <ul class="plain">
          {#each snapshot.problems as problem}<li>{problem}</li>{/each}
        </ul>
        <p class="quiet">The agent is told to fix these at its next run.</p>
      </section>
    {/if}

    <section aria-labelledby="mind-waiting">
      <h2 id="mind-waiting" tabindex="-1">Waiting on you</h2>
      {#if open.length}
        <ul class="list">
          {#each open as question (question.id)}
            <li class="card">
              <div class="doc"><host.Markdown text={question.text} /></div>
              {#if question.detail}<div class="doc quiet"><host.Markdown text={question.detail} /></div>{/if}
              <div class="actions">
                <button type="button" class="primary" disabled={busy === question.id} onclick={(e) => answer(question, AS_RECOMMENDED, e)}>Do as recommended</button>
                <button type="button" disabled={busy === question.id} onclick={(e) => answer(question, NO, e)}>No, don't</button>
              </div>
              <form class="own" onsubmit={(e) => { e.preventDefault(); if (own[question.id]?.trim()) answer(question, own[question.id]!, e); }}>
                <label class="quiet" for={`mind-own-${question.id}`}>Or answer in your own words</label>
                <div class="row">
                  <input id={`mind-own-${question.id}`} type="text" maxlength="2000" bind:value={own[question.id]} />
                  <button type="submit" disabled={busy === question.id || !own[question.id]?.trim()}>Send</button>
                </div>
              </form>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="quiet">Nothing. The agent asks here when it needs you, and carries on meanwhile.</p>
      {/if}
      {#if answered.length}
        <ul class="list">
          {#each answered as question (question.id)}
            <li class="card">
              <div class="doc"><host.Markdown text={question.text} /></div>
              <p class="quiet">You answered: {question.answer}</p>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if empty}
      <p class="quiet">Nothing is kept for this place yet. The agent writes its notes and tasks here as it works.</p>
    {:else}
      <section aria-labelledby="mind-tasks">
        <h2 id="mind-tasks" tabindex="-1">Tasks</h2>
        {#each [["Doing", snapshot.doing], ["To do", snapshot.todo], ["Done lately", snapshot.done]] as [label, text]}
          <h3>{label}</h3>
          {#if text}<div class="doc"><host.Markdown {text} /></div>{:else}<p class="quiet">Nothing.</p>{/if}
        {/each}
      </section>

      <section aria-labelledby="mind-notes">
        <h2 id="mind-notes" tabindex="-1">Notes</h2>
        {#if snapshot.notes}<div class="doc"><host.Markdown text={snapshot.notes} /></div>{:else}<p class="quiet">Not written yet.</p>{/if}
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
          <ul class="plain">
            {#each snapshot.skills as skill (skill.name)}<li><strong>{skill.name}</strong> <span class="quiet">{skill.description}</span></li>{/each}
          </ul>
        </section>
      {/if}
    {/if}

    {#if snapshot.changes.length}
      <section aria-labelledby="mind-changes">
        <h2 id="mind-changes" tabindex="-1">Changed lately</h2>
        <ul class="list">
          {#each snapshot.changes as change (change.id)}
            <li class="row">
              <span>{change.label} <span class="quiet">{change.created ? "created" : "changed"} {when(change.at)}</span></span>
              <button type="button" class="subtle" disabled={busy === change.id} aria-label={`Undo the change to ${change.label} of ${when(change.at)}`} onclick={() => act(change.id, "undo", { id: change.id }, (label) => (notice = `${label} was put back as it was before that change.`))}>Undo</button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section aria-labelledby="mind-tidy">
      <h2 id="mind-tidy" tabindex="-1">Tidy</h2>
      <p class="quiet">The agent checks its notes against how things are, clears what's stale and tells you only what needs you.</p>
      <div class="actions">
        <button type="button" disabled={busy === "tidy"} onclick={() => act("tidy", "tidy", undefined, () => (notice = "Tidying started in the conversation."))}>Tidy now</button>
        <button type="button" disabled={busy === "weekly"} onclick={() => act("weekly", "weekly", undefined, (text) => (notice = String(text)))}>Tidy every week…</button>
      </div>
    </section>
  {/if}
</div>

<style>
  .mind {
    max-width: 46rem;
    margin: 0 auto;
    padding: 1.25rem 1rem 3rem;
    color: var(--foreground);
    font-family: var(--font-sans);
    display: grid;
    gap: 1.75rem;
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
  h3 {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted-foreground);
    margin: 0.4rem 0 0;
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
  .own {
    display: grid;
    gap: 0.25rem;
  }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 0.9rem;
    padding: 0.35rem 0.55rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--background);
    color: var(--foreground);
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
  input:focus-visible,
  summary:focus-visible,
  h2:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
</style>
