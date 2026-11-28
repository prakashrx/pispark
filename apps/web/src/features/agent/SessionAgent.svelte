<script lang="ts">
  /**
   * The agent for one session (Details → Agent for this session): the same tabs and parts as an
   * agent's page, editing the session's own layer, which builds on its agent. What's changed here
   * stays with this session. No profile or settings: those belong to the agent.
   */
  import Tabs from "../../lib/ui/Tabs.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import { agentError } from "./agent-presentation";
  import { AgentPage, KINDS, type Kind } from "./agent-page.svelte";
  import InstructionsTab from "./InstructionsTab.svelte";
  import SkillsTab from "./SkillsTab.svelte";
  import PromptsTab from "./PromptsTab.svelte";
  import ExtensionsTab from "./ExtensionsTab.svelte";

  let { session, agent }: { session: string; /** The session's agent, by name. */ agent: string } = $props();
  const client = useSessions().agents;
  // svelte-ignore state_referenced_locally
  const page = new AgentPage(client, { session });
  // Unsaved text on the page: closing the browser tab asks first.
  $effect(() => {
    client.drafts = { page: page.changed };
    return () => (client.drafts = {});
  });
  $effect(() => {
    void client.open({ session });
  });
  const view = $derived(client.view && "session" in client.view.target && client.view.target.session === session ? client.view : undefined);
  let width = $state(0);
  const narrow = $derived(width > 0 && width < 760);
  let tab = $state<string>("instructions");
  const kinds: Kind[] = ["instructions", "skills", "prompts", "extensions"];
  const tabs = $derived(
    kinds.map((k) => ({ id: k, label: KINDS[k].title, count: (view?.items ?? []).filter((item) => item.type === k && item.on).length })),
  );
</script>

<div class="session-agent" bind:clientWidth={width}>
  {#if client.editorError}<p role="alert" class="inline-note" data-tone="danger">{client.editorError}</p>{/if}
  {#if view?.error}<p role="alert" class="inline-note" data-tone="danger">{agentError(view.error, view.detail)}</p>{/if}
  {#if !view && !client.editorError}<p role="status" class="loading">Loading…</p>{/if}
  {#if view}
    <p class="status" role="status" aria-live="polite">{client.busy ? "Saving…" : client.status}</p>
    <Tabs label={`Agent for this session`} {tabs} bind:value={tab}>
      {#snippet children(current)}
        {#if current === tab}
          {#if current === "instructions"}<InstructionsTab {page} {narrow} name={agent} />
          {:else if current === "skills"}<SkillsTab {page} {narrow} stacked={true} />
          {:else if current === "prompts"}<PromptsTab {page} {narrow} stacked={true} />
          {:else}<ExtensionsTab {page} />{/if}
        {/if}
      {/snippet}
    </Tabs>
  {/if}
</div>

<style>
  .session-agent {
    container: agent / inline-size;
  }
  .loading,
  .status {
    min-height: 1.25rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
</style>
