<script lang="ts">
  import type { Segment, ToolCall } from "./chat-turns";
  import ToolDetail from "./ToolDetail.svelte";
  import { describeCall, summarizeCalls } from "./tool-views";
  import { resolveToolView } from "./views.svelte";

  /** Consecutive tool calls as one quiet line that opens into what each call did. */
  let { segment }: { segment: Extract<Segment, { kind: "activity" }> } = $props();
  const calls = $derived(segment.calls);
  const live = $derived(segment.live);
  let open = $state(false);
  let openCall = $state<string>();

  const failed = $derived(calls.filter((call) => call.status === "error").length);
  const unfinished = $derived(calls.some((call) => call.status === "unfinished"));
  const label = $derived.by(() => {
    if (live) {
      // Say what is happening now, not what has happened so far.
      const current = calls.findLast((call) => call.status === "running") ?? calls.at(-1)!;
      const words = describeCall(current);
      return `${words.doing}${words.object ? ` ${words.object}` : ""}…`;
    }
    const summary = summarizeCalls(calls);
    return [summary, failed ? `${failed} failed` : "", unfinished ? "didn’t finish" : ""].filter(Boolean).join(" · ");
  });
  // While a call runs, the end of what it has output so far shows under the line.
  const running = $derived(live ? calls.findLast((call) => call.status === "running" && call.progress?.output) : undefined);
  const lastLines = $derived(running?.progress?.output.trimEnd().split("\n").slice(-6).join("\n") ?? "");
  const rowLabel = (call: ToolCall) => {
    const words = describeCall(call);
    const verb = call.status === "running" ? words.doing : words.done;
    return `${verb}${words.object ? ` ${words.object}` : ""}`;
  };
</script>

<div class="activity" data-purpose="activity">
  <button type="button" class="activity-toggle" aria-expanded={open} onclick={() => (open = !open)}>
    {#if live}<span class="activity-spinner" aria-hidden="true"></span>{:else}
      <svg class="activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.3l-2.5 2.5-2.3-.6-.6-2.3 2.4-2.6Z" />
      </svg>
    {/if}
    <span class="activity-label">{label}</span>
    <svg class="activity-chevron" class:open viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  </button>
  {#if lastLines}<pre class="activity-progress">{lastLines}</pre>{/if}
  {#if open}
    <ul class="activity-list">
      {#each calls as call (call.id)}
        <li>
          <button
            type="button"
            class="call-toggle"
            data-status={call.status}
            aria-expanded={openCall === call.id}
            onclick={() => (openCall = openCall === call.id ? undefined : call.id)}
          >
            <span class="call-dot" aria-hidden="true"></span>
            <span class="call-label">{rowLabel(call)}</span>
            {#if call.status === "error"}<span class="call-state">failed</span>{:else if call.status === "unfinished"}<span class="call-state">didn’t finish</span>{/if}
          </button>
          {#if openCall === call.id}
            {@const Detail = resolveToolView(call.name).detail ?? ToolDetail}
            <Detail {call} />
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .activity {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.375rem;
    min-width: 0;
  }
  .activity-toggle,
  .call-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.125rem 0.375rem 0.125rem 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    font: inherit;
    font-size: 0.875rem;
    color: var(--muted-foreground);
    cursor: pointer;
    text-align: left;
    transition: color 0.12s;
  }
  .activity-toggle:hover,
  .call-toggle:hover {
    color: var(--foreground);
  }
  .activity-icon {
    width: 0.95rem;
    height: 0.95rem;
    flex: none;
  }
  .activity-spinner {
    width: 0.8rem;
    height: 0.8rem;
    flex: none;
    border: 2px solid var(--border);
    border-top-color: var(--interactive);
    border-radius: 50%;
    animation: activity-spin 0.8s linear infinite;
  }
  @keyframes activity-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .activity-chevron {
    width: 0.8rem;
    height: 0.8rem;
    flex: none;
    color: var(--subtle-foreground);
    transition: transform 0.15s;
  }
  .activity-chevron.open {
    transform: rotate(180deg);
  }
  .activity-progress {
    align-self: stretch;
    margin: 0 0 0 1.45rem;
    padding: 0.375rem 0.625rem;
    border-left: 2px solid var(--border);
    font-family: var(--font-mono);
    font-variant-ligatures: none;
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--muted-foreground);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .activity-list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    align-self: stretch;
    margin: 0 0 0 0.45rem;
    padding: 0 0 0 0.9rem;
    border-left: 2px solid var(--border);
    list-style: none;
  }
  .call-toggle {
    font-size: 0.8125rem;
  }
  .call-dot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: var(--success);
  }
  [data-status="running"] .call-dot {
    background: var(--warning);
  }
  [data-status="error"] .call-dot {
    background: var(--danger);
  }
  [data-status="unfinished"] .call-dot {
    background: var(--subtle-foreground);
  }
  .call-state {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }
  [data-status="error"] .call-state {
    color: var(--danger-foreground);
  }
</style>
