<script lang="ts">
  import ExtensionBlock from "../ExtensionBlock.svelte";
  import StreamingMarkdown from "../StreamingMarkdown.svelte";
  import { itemText, type Segment } from "../chat-turns";

  /** A custom message or entry: the extension's own rendering when it has one, else its text. */
  let { segment }: { segment: Extract<Segment, { kind: "custom" }> } = $props();
</script>

{#if segment.item.rendered?.body}
  <ExtensionBlock lines={segment.item.rendered.body} />
{:else}
  <StreamingMarkdown text={itemText(segment.item)} />
{/if}
