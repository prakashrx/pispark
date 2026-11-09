<script lang="ts">
  import DiffView from "../DiffView.svelte";
  import type { Segment } from "../chat-turns";

  let { segment }: { segment: Extract<Segment, { kind: "diff" }> } = $props();
</script>

<DiffView patch={segment.patch} path={segment.path} clipped={segment.clipped} />
