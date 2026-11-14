<script lang="ts">
  import ExtensionBlock from "../ExtensionBlock.svelte";
  import type { Segment } from "../session-turns";

  let { segment }: { segment: Extract<Segment, { kind: "notice" }> } = $props();
</script>

<ExtensionBlock lines={segment.notice.lines} kind={segment.notice.kind} />
