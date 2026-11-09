<script lang="ts">
  import ViewSlot from "../ViewSlot.svelte";
  import type { Segment } from "../chat-turns";

  /** A tool call drawn by its extension's component, in the message under the call. */
  let { segment }: { segment: Extract<Segment, { kind: "view" }> } = $props();
</script>

<ViewSlot slot={segment.slot} data={{ call: segment.call }} />
