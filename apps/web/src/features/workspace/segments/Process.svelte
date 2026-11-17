<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "../../../lib/ui/Icon.svelte";
  import { useSession, useSessions } from "../session-client.svelte";
  import { details } from "../details.svelte";
  import { processName, processState } from "../../background/process-presentation";
  import type { ProcessInfo } from "../../../../../server/src/contract/process-protocol";
  import type { Segment } from "../session-turns";
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
  const name = $derived(shown ? processName(shown) : segment.title);
</script>

<!-- A quiet line (design set 3): name · state, the output beside, Stop while it runs. -->
<div class="started" data-purpose="process-row">
  <Icon name="terminal" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  <span class="min-w-0 truncate">{name}</span>
  <span class="state">· {shown ? processState(shown) : "Starting…"}</span>
  {#if session}<button
      type="button"
      class="icon"
      aria-label={`Show output of ${name}`}
      title="Show output"
      onclick={() => details.show(session.id, "tasks", segment.processId)}><Icon name="expand" class="h-3.5 w-3.5" /></button
    >
    {#if shown?.state === "running"}<button
        type="button"
        class="icon"
        aria-label={`Stop ${name}`}
        title="Stop"
        onclick={() => void client.processes.stop(session.id, segment.processId)}><Icon name="stop" class="h-3.5 w-3.5" /></button
      >{/if}{/if}
</div>

<style>
  .started {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 1.75rem;
    font-size: var(--text-sm);
  }
  .state {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
  }
  .icon:hover {
    background: var(--accent);
    color: var(--foreground);
  }
</style>
