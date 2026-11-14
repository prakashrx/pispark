<script lang="ts">
  import { onDestroy } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import type { ProcessInfo } from "../../../../server/src/contract/process-protocol";
  import { useSessions } from "../workspace/session-client.svelte";
  import { processName, processState } from "./process-presentation";
  /**
   * The processes a session started: each with its state, its output while shown (read about once a
   * second while it runs), and Stop.
   */
  let { sessionId, focus }: { sessionId: string; focus?: string } = $props();
  const client = useSessions();
  let processes = $state<ProcessInfo[]>([]);
  let loaded = $state(false);
  let error = $state("");
  // svelte-ignore state_referenced_locally
  let shown = $state<Set<string>>(new Set(focus ? [focus] : []));
  const output = $state<Record<string, { text: string; next: number; cut?: boolean }>>({});
  const KEEP = 200_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let now = $state(Date.now());

  async function poll() {
    try {
      processes = (await client.processes.of(sessionId)).reverse();
      loaded = true;
      // The newest running one is shown when nothing was asked for.
      if (!shown.size && processes[0]) shown = new Set([processes[0].id]);
      for (const id of shown) {
        const process = processes.find((p) => p.id === id);
        if (!process) continue;
        const known = output[id];
        if (known && known.next >= process.written) continue;
        const read = await client.processes.output(sessionId, id, known?.next ?? 0);
        const text = (known?.text ?? "") + read.text;
        output[id] = { text: text.length > KEEP ? text.slice(-KEEP) : text, next: read.next, cut: read.cut || text.length > KEEP || known?.cut };
      }
      error = "";
    } catch (failure) {
      error = (failure as Error).message;
    }
    now = Date.now();
    if (!closed) timer = setTimeout(() => void poll(), processes.some((p) => p.state === "running") ? 1000 : 5000);
  }
  $effect(() => {
    void poll();
  });
  onDestroy(() => {
    closed = true;
    clearTimeout(timer);
  });
  function toggle(id: string) {
    const next = new Set(shown);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    shown = next;
    clearTimeout(timer);
    void poll();
  }
  // Output follows its end while you are at the end.
  function follow(node: HTMLElement, _text: string) {
    let atEnd = true;
    node.addEventListener("scroll", () => (atEnd = node.scrollTop + node.clientHeight >= node.scrollHeight - 8));
    const stick = () => {
      if (atEnd) node.scrollTop = node.scrollHeight;
    };
    stick();
    return { update: stick };
  }
</script>

<div class="space-y-3">
  {#if processes.length}
    <ul aria-label="Processes">
      {#each processes as process (process.id)}
        {@const open = shown.has(process.id)}
        <li class="row">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Icon name="terminal" class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="name">{processName(process)}</span>
            <span class="text-xs text-muted-foreground">{processState(process, now)}</span>
            {#if process.title}<span class="min-w-0 truncate text-xs text-muted-foreground">{process.command}</span>{/if}
            <span class="ml-auto flex gap-1">
              <Button size="compact" variant="ghost" aria-expanded={open} onclick={() => toggle(process.id)}
                >{open ? "Hide output" : "Show output"}<span class="sr-only"> of {processName(process)}</span></Button
              >
              {#if process.state === "running"}<Button size="compact" onclick={() => void client.processes.stop(sessionId, process.id)}
                  >Stop<span class="sr-only"> {processName(process)}</span></Button
                >{/if}
            </span>
          </div>
          {#if open}
            {@const out = output[process.id]}
            <!-- A scrolling region is focusable so it can be scrolled with the keyboard. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <pre class="log" aria-label={`Output of ${processName(process)}`} tabindex="0" use:follow={out?.text ?? ""}>{out
                ? out.text || "(no output yet)"
                : "Reading…"}</pre>
            <p class="mt-1.5 text-xs text-muted-foreground">
              {process.state === "running" ? "Live" : "Ended"} · kept with this chat (the newest 2 MB){out?.cut ? " · older output was cut" : ""}
            </p>
          {/if}
        </li>
      {/each}
    </ul>
  {:else if loaded}<p class="text-sm text-muted-foreground">
      No processes yet. The agent starts one when it runs something in the background, such as a dev server.
    </p>{:else}<p class="text-sm text-muted-foreground">Loading…</p>{/if}
  {#if error}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{error}</p>{/if}
</div>

<style>
  .row {
    list-style: none;
    padding: 0.625rem 0;
  }
  .row + .row {
    border-top: 1px solid var(--border);
  }
  .name {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.875rem;
    font-weight: 500;
  }
  .log {
    margin-top: 0.5rem;
    max-height: 18rem;
    overflow: auto;
    padding: 0.75rem 0.875rem;
    border-radius: var(--radius-md);
    background: var(--muted);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
