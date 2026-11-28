<script lang="ts">
  import { onDestroy } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import type { ProcessInfo } from "../../../../server/src/contract/process-protocol";
  import { useSessions } from "../workspace/session-client.svelte";
  import { nextRead, processName, processState, shownAfter, type ShownOutput } from "./process-presentation";
  /**
   * One process a session started (design set 4/3): its name, its state, its output (read about once
   * a second while it runs, following the end) and Stop. The one asked for, or the newest.
   */
  let { sessionId, focus }: { sessionId: string; focus?: string } = $props();
  const client = useSessions();
  let process = $state<ProcessInfo>();
  let loaded = $state(false);
  let error = $state("");
  let output = $state<ShownOutput>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let now = $state(Date.now());

  async function poll() {
    clearTimeout(timer);
    try {
      const all = await client.processes.of(sessionId);
      process = all.find((p) => p.id === focus) ?? all.findLast((p) => p.state === "running") ?? all.at(-1);
      loaded = true;
      if (process && (!output || output.next < process.written)) {
        const { since, fresh } = nextRead(process.written, output);
        output = shownAfter(output, await client.processes.output(sessionId, process.id, since), fresh);
      }
      error = "";
    } catch (failure) {
      error = (failure as Error).message;
    }
    now = Date.now();
    if (!closed) timer = setTimeout(() => void poll(), process?.state === "running" ? 1000 : 5000);
  }
  $effect(() => {
    void poll();
  });
  onDestroy(() => {
    closed = true;
    clearTimeout(timer);
  });
  // Output follows its end while you are at the end.
  function follow(node: HTMLElement, _text: string) {
    let atEnd = true;
    const scrolled = () => (atEnd = node.scrollTop + node.clientHeight >= node.scrollHeight - 8);
    node.addEventListener("scroll", scrolled, { passive: true });
    const stick = () => {
      if (atEnd) node.scrollTop = node.scrollHeight;
    };
    stick();
    return { update: stick, destroy: () => node.removeEventListener("scroll", scrolled) };
  }
</script>

{#if process}
  {@const name = processName(process)}
  <div class="output">
    <div>
      <p class="name">{name}</p>
      <p class="state">
        {processState(process, now)} · kept with this session{output?.cut ? " · older output was cut" : ""}
      </p>
    </div>
    <!-- A scrolling region is focusable so it can be scrolled with the keyboard. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <pre class="log" aria-label={`Output of ${name}`} tabindex="0" use:follow={output?.text ?? ""}>{output
        ? output.text || "(no output yet)"
        : "Reading…"}</pre>
    {#if process.state === "running"}<div>
        <Button size="compact" onclick={() => void client.processes.stop(sessionId, process!.id)}
          >Stop<span class="sr-only"> {name}</span></Button
        >
      </div>{/if}
  </div>
{:else if loaded}<p class="text-sm text-muted-foreground">
    No processes yet. The agent starts one when it runs something in the background, such as a dev server.
  </p>{:else}<p class="text-sm text-muted-foreground">Loading…</p>{/if}
{#if error}<p role="alert" class="mt-2 text-sm text-[var(--danger-foreground)]">{error}</p>{/if}

<style>
  .output {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .name {
    font-weight: 500;
  }
  .state {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .log {
    min-height: 10rem;
    max-height: 60dvh;
    overflow: auto;
    padding: 0.75rem 0.875rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--code-surface, var(--muted));
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
