<script lang="ts">
  import { onMount } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import AgentCollection from "./AgentCollection.svelte";
  import AgentEditor from "./AgentEditor.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  const sessions = useSessions();
  const client = sessions.agents;
  onMount(() => {
    void client.refresh();
  });
</script>

<main
  id="workspace"
  class="flex-1 overflow-y-auto px-8 pt-10 pb-4"
  aria-label="Agent management"
>
  <div class="max-w-3xl mx-auto space-y-6 pb-16">
    {#if client.mode === "editor" && client.target}
      <Button variant="ghost" size="compact" onclick={() => client.collection()}
        ><Icon name="back" class="h-4 w-4" />All agents</Button
      >
      <AgentEditor target={client.target} />
    {:else}
      <AgentCollection {client} />
    {/if}
  </div>
</main>
