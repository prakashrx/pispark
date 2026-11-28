<script lang="ts">
  /**
   * The agents (set 1): one card each with its mark, name, what it is (Base, App, Project), what
   * it's for and how many sessions use it. New agent opens a dialog (set 7).
   */
  import Button from "../../lib/ui/Button.svelte";
  import IdentityMark from "../../lib/ui/IdentityMark.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Modal from "../../lib/ui/Modal.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import { href } from "../../routes";
  import { useSessions } from "../workspace/session-client.svelte";
  import type { AgentClient } from "./agent-client.svelte";
  import type { AgentSummary } from "../../../../server/src/contract/agent-protocol";

  let { client, creating = $bindable(false) }: { client: AgentClient; creating?: boolean } = $props();
  const sessions = useSessions();
  let query = $state("");
  let name = $state("");
  let description = $state("");
  let base = $state("");
  const visible = $derived(
    client.items.filter((item) => `${item.name} ${item.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const baseOptions = $derived([
    { value: "", label: "Only Default" },
    ...client.items.filter((p) => !p.builtIn && p.valid).map((p) => ({ value: p.id, label: p.name })),
  ]);
  const kind = (item: AgentSummary) =>
    item.builtIn ? "Base" : item.bundled ? "Bundled" : item.home ? "App" : item.folder ? "Project" : "";
  const count = (item: AgentSummary) => {
    const n = sessions.sessions.filter((s) => s.agent.id === item.id).length;
    return n === 1 ? "1 session" : `${n} sessions`;
  };
  function close() {
    creating = false;
    name = description = base = "";
  }
  async function create() {
    if (!name.trim()) return;
    if (await client.create(name.trim(), description, base ? [base] : [])) close();
  }
</script>

<p class="lede">Reusable sets of instructions, skills, extensions and tools. Every agent builds on Default.</p>
{#if client.items.length > 6}<div class="search"><Input label="Search agents" placeholder="Search agents…" bind:value={query} /></div>{/if}
{#if client.error}<p role="alert" class="inline-note" data-tone="danger">{client.error}</p>{/if}
{#if client.loading && !client.items.length}<p role="status" class="text-sm text-muted-foreground">Loading agents…</p>{/if}
<ul class="grid">
  {#each visible as item (item.id)}
    <li>
      <a class="card" href={href({ name: "agents", id: item.id })}>
        <IdentityMark name={item.name} size="lg" />
        <span class="min-w-0 flex-1">
          <span class="title">
            <span class="name">{item.name}</span>{#if kind(item)}<span class="tag">{kind(item)}</span>{/if}
          </span>
          <span class="what">
            {item.builtIn
              ? "The base of every agent."
              : (item.description ?? (item.base.length ? `Builds on ${item.base.join(", ")}` : "Builds on Default"))}
          </span>
          <span class="count">{count(item)}</span>
          {#if !item.valid}<span class="status">Needs attention</span>{/if}
        </span>
      </a>
    </li>
  {:else}{#if !client.loading}<li class="py-6 text-sm text-muted-foreground">No matching agents.</li>{/if}{/each}
</ul>

{#if creating}
  <Modal label="New agent" title="New agent" onclose={close}>
    <form
      id="new-agent"
      class="space-y-4"
      aria-label="New agent"
      onsubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <div>
        <label class="field-label" for="new-agent-name">Name</label>
        <Input id="new-agent-name" label="Name" bind:value={name} maxlength={120} required />
      </div>
      <div>
        <label class="field-label" for="new-agent-for">What it’s for (optional)</label>
        <Textarea id="new-agent-for" label="What it’s for (optional)" rows={2} bind:value={description} maxlength={1024} />
      </div>
      <div>
        <p class="text-sm font-medium mb-1.5">Builds on</p>
        <div class="flex flex-wrap items-center gap-2">
          <span class="chip">Default <span class="text-muted-foreground">· always</span></span>
          <Selector label="Builds on" display="field" options={baseOptions} bind:value={base} />
        </div>
      </div>
      {#if client.editorError}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{client.editorError}</p>{/if}
    </form>
    {#snippet primary()}
      <Button
        variant="primary"
        type="submit"
        form="new-agent"
        unavailable={!name.trim() ? "Add a name" : client.busy ? "Creating…" : undefined}
      >
        Create
      </Button>
    {/snippet}
  </Modal>
{/if}

<style>
  .lede {
    font-size: var(--text-sm);
    color: var(--muted-foreground);
    margin-bottom: 0.75rem;
  }
  .search {
    margin-bottom: 0.75rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
    gap: 0.75rem;
  }
  .card {
    height: 100%;
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-card, var(--radius-md));
    background: var(--card);
  }
  .card:hover {
    border-color: var(--input);
  }
  .title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .name {
    font-weight: 600;
    font-size: var(--text-base);
  }
  .tag {
    padding: 0 0.375rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--text-2xs, 0.6875rem);
    color: var(--muted-foreground);
  }
  .what {
    display: block;
    margin-top: 0.125rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
    overflow-wrap: anywhere;
  }
  .count {
    display: block;
    margin-top: 0.375rem;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .status {
    display: inline-block;
    margin-top: 0.5rem;
    padding: 0.05rem 0.5rem;
    border-radius: var(--radius-full);
    font-size: 0.6875rem;
    font-weight: 500;
    background: var(--warning-muted);
    color: var(--warning-foreground);
  }
  .field-label {
    display: block;
    margin-bottom: 0.375rem;
    font-size: var(--text-sm);
    font-weight: 500;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.625rem;
    border-radius: var(--radius-full);
    background: var(--chip);
    font-size: var(--text-sm);
  }
</style>
