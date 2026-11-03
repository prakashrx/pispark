<script lang="ts">
  import { tick } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  let {
    index,
    count,
    label,
    move,
    remove,
    disabled = false,
  }: {
    index: number;
    count: number;
    label: string;
    move: (from: number, to: number) => void;
    remove: () => void;
    disabled?: boolean;
  } = $props();
  let root: HTMLDivElement;
  async function reorder(to: number) {
    const direction = to < index ? "up" : "down";
    move(index, to);
    await tick();
    const target =
      root.querySelector<HTMLButtonElement>(
        `[data-order="${direction}"]:not(:disabled)`,
      ) ?? root.querySelector<HTMLButtonElement>("button:not(:disabled)");
    target?.focus();
  }
</script>

<div class="flex items-center gap-1 flex-wrap" bind:this={root}>
  <Button
    class="source-action"
    aria-label={`Move ${label} up`}
    data-order="up"
    disabled={disabled || index === 0}
    onclick={() => reorder(index - 1)}>↑</Button
  >
  <Button
    class="source-action"
    aria-label={`Move ${label} down`}
    data-order="down"
    disabled={disabled || index === count - 1}
    onclick={() => reorder(index + 1)}>↓</Button
  >
  <Button
    class="source-action"
    aria-label={`Remove ${label}`}
    {disabled}
    onclick={remove}>Remove</Button
  >
</div>
