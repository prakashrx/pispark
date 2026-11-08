<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import type { PersonaClient } from "./persona-client.svelte";
  let { client }: { client: PersonaClient } = $props();
  let query = $state("");
  let creating = $state(false);
  let name = $state("");
  let description = $state("");
  let base = $state("");
  const visible = $derived(
    client.items.filter((item) =>
      `${item.name} ${item.description ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    ),
  );
  const baseOptions = $derived([
    { value: "", label: "Only Default" },
    ...client.items
      .filter((p) => !p.builtIn && p.valid)
      .map((p) => ({ value: p.id, label: p.name })),
  ]);
  async function create() {
    if (!name.trim()) return;
    if (await client.create(name.trim(), description, base ? [base] : [])) {
      creating = false;
      name = description = base = "";
    }
  }
</script>

<header
  class="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-6 persona-heading"
>
  <div class="space-y-2">
    <h1 class="text-[1.75rem] leading-[1.2] font-[650] tracking-[-0.02em]">Personas</h1>
    <p class="text-sm text-muted-foreground mt-1">
      Reusable setups of instructions, skills, commands and tools. Each builds on Default.
    </p>
  </div>
  <Button variant="primary" onclick={() => (creating = true)}>New persona</Button>
</header>
{#if creating}
  <form
    class="new-persona space-y-3"
    aria-label="New persona"
    onsubmit={(event) => {
      event.preventDefault();
      void create();
    }}
  >
    <Input label="Name" placeholder="Name" bind:value={name} maxlength={120} required />
    <Textarea label="Description" placeholder="What it’s for (optional)" rows={2} bind:value={description} maxlength={1024} />
    <Selector label="Builds on" display="field" options={baseOptions} bind:value={base} />
    {#if client.editorError}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{client.editorError}</p>{/if}
    <div class="flex justify-end gap-2">
      <Button variant="ghost" onclick={() => (creating = false)}>Cancel</Button>
      <Button variant="primary" type="submit" unavailable={!name.trim() ? "Add a name" : client.busy ? "Creating…" : undefined}
        >Create persona</Button
      >
    </div>
  </form>
{/if}
{#if client.items.length > 6}<Input label="Search personas" placeholder="Search personas…" bind:value={query} />{/if}
{#if client.error}<p role="alert" class="inline-note" data-tone="danger">{client.error}</p>{/if}
{#if client.loading && !client.items.length}<p role="status" class="text-sm text-muted-foreground">Loading personas…</p>{/if}
<ul class="persona-grid">
  {#each visible as item (item.id)}
    <li>
      <button
        type="button"
        class="persona-card"
        onclick={() => void client.open({ persona: item.id })}
      >
        <span class="avatar" aria-hidden="true">{item.name.slice(0, 1)}</span>
        <span class="min-w-0 flex-1">
          <span class="block font-medium text-[0.9375rem] break-words">{item.name}</span>
          <span class="block text-[0.8125rem] text-muted-foreground mt-0.5 break-words line-clamp-2"
            >{item.builtIn
              ? "The base of every persona."
              : item.description ?? (item.base.length ? `Builds on ${item.base.join(", ")}` : "Builds on Default")}</span
          >
          {#if !item.valid}<span class="status" data-tone="warning">Needs attention</span>{/if}
        </span>
      </button>
    </li>
  {:else}{#if !client.loading}<li class="py-6 text-sm text-muted-foreground">No matching personas.</li>{/if}{/each}
</ul>

<style>
  .new-persona {
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
  }
  .persona-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: 0.75rem;
  }
  .persona-card {
    width: 100%;
    height: 100%;
    display: flex;
    gap: 0.875rem;
    align-items: flex-start;
    text-align: left;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--card);
    color: var(--foreground);
    transition: border-color 0.12s, box-shadow 0.12s, transform 0.12s;
  }
  .persona-card:hover {
    border-color: var(--input);
    box-shadow: var(--shadow-sm);
    transform: translateY(-1px);
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    flex-shrink: 0;
    border-radius: var(--radius);
    background: var(--interactive-muted);
    color: var(--interactive-text);
    font-weight: 650;
    font-size: 1rem;
  }
  .status {
    display: inline-block;
    margin-top: 0.5rem;
    font-size: 0.6875rem;
    font-weight: 500;
    padding: 0.05rem 0.5rem;
    border-radius: var(--radius-full);
    background: var(--warning-muted);
    color: var(--warning-foreground);
  }
</style>
