<script lang="ts">
  import ExtensionBlock from "../ExtensionBlock.svelte";
  import StreamingMarkdown from "../StreamingMarkdown.svelte";
  import ViewSlot from "../ViewSlot.svelte";
  import { itemText, type Segment } from "../chat-turns";
  import { contributionsFor } from "../extension-views";
  import { useSessions } from "../session-client.svelte";

  /**
   * A custom message or entry: the component its extension placed in `entry:<customType>`, else its
   * terminal rendering, else its text.
   */
  let { segment }: { segment: Extract<Segment, { kind: "custom" }> } = $props();
  const client = useSessions();
  const slot = $derived(`entry:${segment.item.customType ?? ""}`);
  const placed = $derived(!!segment.item.customType && contributionsFor(client.snapshot?.extensions, slot).length > 0);
</script>

{#if placed}
  <ViewSlot {slot} data={{ item: segment.item }} />
{:else if segment.item.rendered?.body}
  <ExtensionBlock lines={segment.item.rendered.body} />
{:else}
  <StreamingMarkdown text={itemText(segment.item)} />
{/if}
