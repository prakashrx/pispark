<script lang="ts">
  import type { Snippet } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import PersonaDetails from "./PersonaDetails.svelte";
  import { personaKey, type PersonaClient } from "./persona-client.svelte";
  import type { PersonaRef } from "../../../../server/src/persona-protocol";
  let {
    client,
    onnew,
    onopen,
    children,
  }: {
    client: PersonaClient;
    onnew: () => void;
    onopen: (ref: PersonaRef) => void;
    children?: Snippet;
  } = $props();
  let query = $state("");
  const visible = $derived(
    client.items.filter((item) =>
      `${item.name} ${item.description ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    ),
  );
</script>

<header
  class="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-6 persona-heading"
>
  <div class="space-y-2">
    <h1 class="text-[1.75rem] leading-[1.2] font-[650] tracking-[-0.02em] text-zinc-900">Personas</h1>
    <p class="text-sm text-zinc-500 mt-1">
      Reusable instructions and skills for your chats.
    </p>
  </div>
  <Button variant="primary" onclick={onnew}>New persona</Button>
</header>
{@render children?.()}
<div class="flex gap-3 items-center">
  <div class="flex-1 min-w-0">
    <Input
      label="Search personas"
      placeholder="Search personas…"
      bind:value={query}
    />
  </div>
  <Button
    variant="ghost"
    unavailable={client.loading ? "Loading personas" : undefined}
    onclick={() => void client.refresh()}>Refresh</Button
  >
</div>
<PersonaDetails error={client.error} />
{#if client.loading}<p role="status" class="text-sm text-muted-foreground">Loading personas…</p>{/if}
{#if !client.loading && !client.items.length}
  <p class="inline-note" data-tone="info">
    Create a persona to give your chats a reusable set of instructions and
    skills.
  </p>
{:else if client.items.length}
  <ul class="persona-grid">
    {#each visible as item}
      {@const status =
        client.hasUnsavedFilesFor(item.ref) ||
        (client.view &&
          personaKey(item.ref) === personaKey(client.view.ref) &&
          client.dirty)
          ? "Unsaved changes"
          : client.hasUnappliedContentFor(item.ref)
            ? "Unapplied prompt changes"
            : !item.valid
              ? "Needs attention"
              : !item.writable
                ? "Read-only"
                : ""}
      <li>
        <button
          type="button"
          data-persona-key={personaKey(item.ref)}
          class="persona-card"
          onclick={() => onopen(item.ref)}
        >
          <span class="avatar" aria-hidden="true">{item.name.slice(0, 1)}</span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium text-[0.9375rem] break-words">{item.name}</span>
            {#if item.description}<span
                class="block text-[0.8125rem] text-muted-foreground mt-0.5 break-words line-clamp-2"
                >{item.description}</span
              >{/if}
            {#if status}<span
                class="status"
                data-tone={status === "Needs attention" || status.startsWith("Un") ? "warning" : undefined}
                >{status}</span
              >{/if}
          </span>
        </button>
      </li>
    {:else}<li class="py-6 text-sm text-muted-foreground">
        No matching personas.
      </li>{/each}
  </ul>
{/if}

<style>
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
  .persona-card:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
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
    background: var(--muted);
    color: var(--muted-foreground);
  }
  .status[data-tone="warning"] {
    background: var(--warning-muted);
    color: var(--warning-foreground);
  }
</style>
