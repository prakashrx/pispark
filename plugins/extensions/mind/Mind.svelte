<script lang="ts">
  /** What the agent believes about this place, what it's working on, and what waits on the person. */
  type Origin = { origin: "told" | "inferred"; quote?: string; at: string };
  type Snapshot = {
    charter: ({ id: string; section: string; text: string } & Origin)[];
    contract: ({ id: string; text: string } & Origin)[];
    notes: ({ id: string; claim: string; why: string } & Origin)[];
    skills: ({ name: string; description: string } & Origin)[];
    cards: { id: string; goal: string; stage: string; doneWhen?: string; state?: string; next?: string; waitingOn?: string; authority?: string }[];
    proposals: { id: string; text: string; reason: string; at: string }[];
    findings: string[];
  };
  let { snapshot, host }: { snapshot?: Snapshot; host: { call: (name: string, data?: unknown) => Promise<unknown> } } = $props();

  const SECTIONS: [string, string][] = [["purpose", "Purpose"], ["for-whom", "For whom"], ["good", "What good looks like"], ["off-limits", "Off-limits"]];
  const STAGES: [string, string][] = [["active", "Active"], ["waiting", "Waiting"], ["committed", "Committed"], ["idea", "Ideas"], ["done", "Done, waiting for reflection"], ["dropped", "Dropped, waiting for reflection"]];
  let busy = $state<string | undefined>();
  let error = $state<string | undefined>();

  /** Runs a person's action; the row goes away, so focus moves to its section's heading. */
  async function act(name: string, id: string, event: Event) {
    const heading = (event.currentTarget as HTMLElement).closest("section")?.querySelector("h2");
    busy = id;
    error = undefined;
    try {
      await host.call(name, { id });
      heading?.focus();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = undefined;
    }
  }
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  function how(o: Origin): string {
    if (o.origin !== "told") return `Inferred · ${day(o.at)}`;
    if (o.quote?.startsWith("yes to:")) return `You said yes when asked · ${day(o.at)}`;
    if (o.quote?.startsWith("accepted proposal")) return `You accepted it · ${day(o.at)}`;
    return `You said${o.quote ? `: “${o.quote}”` : " this"} · ${day(o.at)}`;
  }
</script>

<div class="mind">
  {#if !snapshot}
    <p class="quiet">Loading…</p>
  {:else}
    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <section aria-labelledby="mind-waiting">
      <h2 id="mind-waiting" tabindex="-1">Waiting on you</h2>
      {#if snapshot.proposals.length}
        <ul class="list">
          {#each snapshot.proposals as p (p.id)}
            <li class="row">
              <div class="body">
                <p>{p.text}</p>
                <p class="quiet">{p.reason} · {day(p.at)}</p>
              </div>
              <div class="actions">
                <button type="button" class="primary" disabled={busy === p.id} onclick={(e) => act("accept", p.id, e)} aria-label={`Accept: ${p.text}`}>Accept</button>
                <button type="button" disabled={busy === p.id} onclick={(e) => act("reject", p.id, e)} aria-label={`Reject: ${p.text}`}>Reject</button>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="quiet">Nothing. The agent asks when it needs you.</p>
      {/if}
      {#if snapshot.findings.length}
        <ul class="findings" aria-label="Audit">
          {#each snapshot.findings as f}<li>{f}</li>{/each}
        </ul>
      {/if}
    </section>

    <section aria-labelledby="mind-charter">
      <h2 id="mind-charter" tabindex="-1">Charter</h2>
      {#if snapshot.charter.length}
        <dl>
          {#each SECTIONS as [key, label]}
            {@const items = snapshot.charter.filter((i) => i.section === key)}
            {#if items.length}
              <dt>{label}</dt>
              {#each items as i (i.id)}
                <dd class="row">
                  <div class="body"><p>{i.text}</p><p class="quiet">{how(i)}</p></div>
                  <button type="button" class="forget" disabled={busy === i.id} onclick={(e) => act("forget", i.id, e)} aria-label={`Forget: ${i.text}`}>Forget</button>
                </dd>
              {/each}
            {/if}
          {/each}
        </dl>
      {:else}
        <p class="quiet">Empty. The agent finds out what it's here for first.</p>
      {/if}
    </section>

    <section aria-labelledby="mind-contract">
      <h2 id="mind-contract" tabindex="-1">Contract</h2>
      {#if snapshot.contract.length}
        <ul class="list">
          {#each snapshot.contract as r (r.id)}
            <li class="row">
              <div class="body"><p>{r.text}</p><p class="quiet">{how(r)}</p></div>
              <button type="button" class="forget" disabled={busy === r.id} onclick={(e) => act("forget", r.id, e)} aria-label={`Forget: ${r.text}`}>Forget</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="quiet">Empty. The agent asks before anything consequential.</p>
      {/if}
    </section>

    <section aria-labelledby="mind-work">
      <h2 id="mind-work" tabindex="-1">Work</h2>
      {#if snapshot.cards.length}
        {#each STAGES as [stage, label]}
          {@const cards = snapshot.cards.filter((c) => c.stage === stage)}
          {#if cards.length}
            <h3>{label} <span class="count">{cards.length}</span></h3>
            <ul class="list">
              {#each cards as c (c.id)}
                <li class="card">
                  <p class="goal">{c.goal}</p>
                  {#if c.doneWhen}<p class="quiet">Done when: {c.doneWhen}</p>{/if}
                  {#if c.state}<p>{c.state}</p>{/if}
                  {#if c.next}<p class="quiet">Next: {c.next}</p>{/if}
                  {#if c.waitingOn}<p class="quiet">Waiting on: {c.waitingOn}</p>{/if}
                  {#if c.authority}<p class="quiet">You allowed: {c.authority}</p>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        {/each}
      {:else}
        <p class="quiet">No cards yet.</p>
      {/if}
    </section>

    <section aria-labelledby="mind-knowledge">
      <h2 id="mind-knowledge" tabindex="-1">Knowledge</h2>
      {#if snapshot.notes.length || snapshot.skills.length}
        <ul class="list">
          {#each snapshot.notes as n (n.id)}
            <li class="row">
              <details class="body">
                <summary>{n.claim}</summary>
                <p>{n.why}</p>
                <p class="quiet">{how(n)}</p>
              </details>
              <button type="button" class="forget" disabled={busy === n.id} onclick={(e) => act("forget", n.id, e)} aria-label={`Forget: ${n.claim}`}>Forget</button>
            </li>
          {/each}
          {#each snapshot.skills as s (s.name)}
            <li class="row">
              <div class="body"><p><span class="tag">Skill</span> {s.name}: {s.description}</p><p class="quiet">{how(s)}</p></div>
              <button type="button" class="forget" disabled={busy === s.name} onclick={(e) => act("forget", s.name, e)} aria-label={`Forget skill ${s.name}`}>Forget</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="quiet">Nothing yet. It grows as goals close.</p>
      {/if}
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
  h2 {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
  }
  h3 {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted-foreground);
    margin: 0.75rem 0 0.35rem;
  }
  p {
    margin: 0;
    line-height: 1.45;
  }
  .quiet {
    color: var(--muted-foreground);
    font-size: 0.85rem;
  }
  .error {
    color: var(--danger);
    font-size: 0.9rem;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .row {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    justify-content: space-between;
  }
  .body {
    min-width: 0;
    flex: 1;
    display: grid;
    gap: 0.15rem;
  }
  dl {
    margin: 0;
    display: grid;
    gap: 0.35rem;
  }
  dt {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted-foreground);
    margin-top: 0.35rem;
  }
  dd {
    margin: 0;
  }
  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.6rem 0.75rem;
    display: grid;
    gap: 0.2rem;
  }
  .goal {
    font-weight: 500;
  }
  .count,
  .tag {
    font-size: 0.75rem;
    color: var(--muted-foreground);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    padding: 0 0.4rem;
  }
  .findings {
    margin: 0.5rem 0 0;
    padding-left: 1.1rem;
    color: var(--muted-foreground);
    font-size: 0.85rem;
  }
  summary {
    cursor: pointer;
  }
  .actions {
    display: flex;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  button {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.3rem 0.7rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--foreground);
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--interactive-hover);
  }
  h2:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  button:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
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
  .forget {
    border-color: transparent;
    color: var(--muted-foreground);
  }
  @media (max-width: 30rem) {
    .row {
      flex-direction: column;
    }
    .actions,
    .forget {
      align-self: flex-end;
    }
  }
</style>
