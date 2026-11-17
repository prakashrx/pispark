<script lang="ts">
  /** Agents (set 1): the list with New agent, or one agent's editor at its own address. */
  import { onMount } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Screen from "../../shell/Screen.svelte";
  import { layout } from "../../shell/layout.svelte";
  import AgentCollection from "./AgentCollection.svelte";
  import AgentEditor from "./AgentEditor.svelte";
  import { useSessions } from "../workspace/session-client.svelte";

  let { id }: { id?: string } = $props();
  const client = useSessions().agents;
  let creating = $state(false);
  onMount(() => void client.refresh());
  const name = $derived(id ? (client.items.find((item) => item.id === id)?.name ?? "Agent") : "Agents");
</script>

{#if id}
  <Screen title={name} hideTitle back={{ name: "agents" }} backLabel="All agents" wide={layout.size !== "compact"}>
    {#snippet actions()}<span class="saved" role="status" aria-live="polite">{client.busy ? "Saving…" : client.status}</span>{/snippet}
    {#key id}<AgentEditor target={{ agent: id }} />{/key}
  </Screen>
{:else}
  <Screen title="Agents" wide={layout.size !== "compact"}>
    {#snippet actions()}<Button variant="primary" size="compact" onclick={() => (creating = true)}>New agent</Button>{/snippet}
    <div class="page"><AgentCollection {client} bind:creating /></div>
  </Screen>
{/if}

<style>
  .page {
    max-width: 62rem;
    margin: 0 auto;
  }
  .saved {
    padding: 0 0.5rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
</style>
