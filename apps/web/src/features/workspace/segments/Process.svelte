<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "../../../lib/ui/Icon.svelte";
  import { useSession, useSessions } from "../session-client.svelte";
  import { showProcess } from "../../background/background-client.svelte";
  import { processName, processState } from "../../background/process-presentation";
  import type { ProcessInfo } from "../../../../../server/src/contract/process-protocol";
  import type { Segment } from "../chat-turns";
  // A process this session started: its name and live state, and a way to see its output.
  let { segment }: { segment: Extract<Segment, { kind: "process" }> } = $props();
  const client = useSessions();
  const session = useSession();
  const running = $derived(client.processes.running.find((p) => p.id === segment.processId));
  // Not among the running ones (or not yet listed): ask the session's own list.
  let known = $state<ProcessInfo>();
  $effect(() => {
    // Asked when it is not (or no longer) among the running ones; what it last knew is not a reason to ask again.
    if (running || !session) return;
    if (untrack(() => known && known.state !== "running")) return;
    void client.processes
      .of(session.id)
      .then((list) => (known = list.find((p) => p.id === segment.processId)))
      .catch(() => {});
  });
  const shown = $derived(running ?? known);
</script>

<div class="started" data-purpose="process-row">
  <Icon name="terminal" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  <span class="min-w-0 flex-1 truncate">{shown ? processName(shown) : segment.title}</span>
  <span class="text-xs text-muted-foreground">{shown ? processState(shown) : "Starting…"}</span>
  {#if session}<button type="button" class="open" onclick={() => showProcess(session.id, segment.processId)}
      >Show output<span class="sr-only"> of {shown ? processName(shown) : segment.title}</span></button
    >{/if}
</div>

<style>
  .started {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
  }
  .open {
    font-size: 0.875rem;
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
