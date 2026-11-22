<script lang="ts" module>
  import type { DetailsView } from "../../routes";
  /** The title a view of a session's Details goes by, in the side panel's bar or as a screen. */
  export function detailsTitle(view: DetailsView, agent = "this agent"): string {
    switch (view) {
      case "details":
        return "Details";
      case "routines":
        return `Routines of ${agent}`;
      case "agent":
        return "Agent for this session";
      case "tasks":
        return "Process output";
      case "file":
        return "File";
    }
  }
</script>

<script lang="ts">
  /**
   * What a session's side panel (or, on compact, its Details screen) shows: the Details panels, or
   * a view opened from them. Each view keeps the words that say what it does.
   */
  import AgentEditor from "../agent/AgentEditor.svelte";
  import ProcessOutput from "../background/ProcessOutput.svelte";
  import FileView from "../files/FileView.svelte";
  import RoutinesPanel from "../background/RoutinesPanel.svelte";
  import DetailsPanels from "./DetailsPanels.svelte";
  import { useSession, useSessions } from "./session-client.svelte";

  /** `focus`: what the view opens on, a process for Background tasks or a file's name. */
  let { view, focus }: { view: DetailsView; focus?: string } = $props();
  const client = useSessions();
  const session = useSession();
  const info = $derived(session.info);

  // Leaving the agent editor: the Agents page shares it, so it gets its own list back; and a
  // changed agent is put to work by reloading the session (once the reply is done, if one runs).
  $effect(() => {
    if (view === "agent") return leaveAgent;
  });
  function leaveAgent() {
    client.agents.collection();
    const doc = session.doc;
    if (doc?.agentChanged && !doc.pending?.reload && !doc.readOnly && client.current?.id === session.id) void session.reload();
  }
</script>

{#if info}
  {#if view === "details"}<DetailsPanels />
  {:else if view === "routines"}
    <p class="help">Each run is a new session of {info.agent.name}{info.agent.home ? ", listed under the app" : ""}.</p>
    <RoutinesPanel agent={info.agent.id} />
  {:else if view === "agent"}
    <p class="help">Changes apply to this session only. Leaving here reloads the session with them; your messages stay.</p>
    <AgentEditor target={{ session: session.id }} embedded />
  {:else if view === "file"}
    {#if focus}<FileView sessionId={session.id} name={focus} />{:else}<p class="help">Choose a file in Details.</p>{/if}
  {:else}
    {#key focus}<ProcessOutput sessionId={session.id} {focus} />{/key}
  {/if}
{/if}

<style>
  .help {
    margin-bottom: 0.75rem;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
