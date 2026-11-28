<script lang="ts">
  // One mark for how an ask stands, by shape and words, never colour alone. Working and failed are
  // the shared status marks; the rest are quiet shapes.
  import type { Ask } from "../../../../server/src/contract/protocol";
  import Icon from "../../lib/ui/Icon.svelte";
  import StatusMark from "../../lib/ui/StatusMark.svelte";

  let { state }: { state: Ask["state"] } = $props();
  const WORDS: Record<Ask["state"], string> = {
    working: "Working",
    waiting: "Waiting",
    asked: "Has a question",
    answered: "Answered",
    stopped: "Stopped",
    failed: "Failed",
  };
</script>

{#if state === "working" || state === "failed"}
  <span class="mark"><StatusMark kind={state === "working" ? "busy" : "error"} label={WORDS[state]} /></span>
{:else}
  <span class="mark" data-state={state} title={WORDS[state]}>
    <Icon name={state === "answered" ? "checkBold" : state === "stopped" ? "stop" : "pause"} class="h-3.5 w-3.5" />
    <span class="sr-only">{WORDS[state]}</span>
  </span>
{/if}

<style>
  .mark {
    width: 1.125rem;
    height: 1.125rem;
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    color: var(--muted-foreground);
  }
  [data-state="answered"] {
    color: var(--success-foreground);
  }
</style>
