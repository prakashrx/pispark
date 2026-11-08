<script lang="ts">
  import { onMount } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import PersonaCollection from "./PersonaCollection.svelte";
  import PersonaEditor from "./PersonaEditor.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  const sessions = useSessions();
  const client = sessions.personas;
  onMount(() => {
    void client.refresh();
  });
</script>

<main
  id="workspace"
  class="flex-1 overflow-y-auto px-8 pt-10 pb-4"
  aria-label="Persona management"
>
  <div class="max-w-3xl mx-auto space-y-6 pb-16">
    {#if client.mode === "editor" && client.target}
      <Button variant="ghost" size="compact" onclick={() => client.collection()}
        ><Icon name="back" class="h-4 w-4" />All personas</Button
      >
      <PersonaEditor target={client.target} />
    {:else}
      <PersonaCollection {client} />
    {/if}
  </div>
</main>
