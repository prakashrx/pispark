<script lang="ts">
  import StatusMark, { type StatusKind } from "../../lib/ui/StatusMark.svelte";
  import { STATE_WORDS, type SessionState } from "./session-presentation";
  /** A session's state as the shared status mark; nothing when it is idle. */
  let { state, words = false, detail }: { state: SessionState; words?: boolean; detail?: string } = $props();
  const kinds: Record<Exclude<SessionState, "">, StatusKind> = {
    "needs-you": "attention",
    failed: "error",
    working: "busy",
    opening: "busy",
    stopping: "busy",
    queued: "waiting",
  };
</script>

{#if state}<StatusMark kind={kinds[state]} label={STATE_WORDS[state]} {words} {detail} />{/if}
