<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Menu from "../../lib/ui/Menu.svelte";
  import PersonaDetails from "./PersonaDetails.svelte";
  import { personaKey, type PersonaClient } from "./persona-client.svelte";
  import type { PersonaRef } from "../../../../server/src/persona-protocol";
  let {
    client,
    onnew,
    onopen,
  }: {
    client: PersonaClient;
    onnew: () => void;
    onopen: (ref: PersonaRef) => void;
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
  class="flex items-start justify-between gap-4 border-b border-zinc-100 pb-6 persona-heading"
>
  <div class="space-y-2">
    <h1 class="text-xl font-semibold tracking-tight text-zinc-900">Personas</h1>
    <p class="text-sm text-zinc-500 mt-1">
      Reusable instructions and skills for your chats.
    </p>
  </div>
  <Button variant="primary" onclick={onnew}>New persona</Button>
</header>
<div class="flex gap-3 items-center">
  <Input
    label="Search personas"
    placeholder="Search personas"
    bind:value={query}
  />
  <Menu
    label="Persona collection actions"
    items={[
      {
        id: "refresh",
        label: "Refresh",
        disabled: client.loading,
        onselect: () => void client.refresh(),
      },
    ]}
  />
</div>
<PersonaDetails error={client.error} />
{#if client.loading}<p role="status" class="text-xs">Loading personas…</p>{/if}
{#if !client.loading && !client.items.length}
  <p class="text-sm text-zinc-500">
    Create a persona to give your chats a reusable set of instructions and
    skills.
  </p>
{:else if client.items.length}
  <ul class="divide-y divide-zinc-100">
    {#each visible as item}
      <li>
        <Button
          variant="ghost"
          data-persona-key={personaKey(item.ref)}
          class="w-full text-left !justify-between !py-4"
          onclick={() => onopen(item.ref)}
        >
          <span class="min-w-0 flex-1"
            ><span class="block font-medium break-words">{item.name}</span
            >{#if item.description}<span
                class="block text-zinc-500 mt-1 break-words"
                >{item.description}</span
              >{/if}</span
          >
          <span class="text-zinc-500 shrink-0"
            >{client.hasUnsavedFilesFor(item.ref) ||
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
                    : ""}</span
          >
        </Button>
      </li>
    {:else}<li class="py-6 text-sm text-zinc-500">
        No matching personas.
      </li>{/each}
  </ul>
{/if}
