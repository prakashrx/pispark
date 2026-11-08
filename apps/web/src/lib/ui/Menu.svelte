<script lang="ts">
  import type { Snippet } from "svelte";
  import Popover from "./Popover.svelte";
  let {
    label,
    items,
    trigger,
    disabled = false,
  }: {
    label: string;
    trigger?: Snippet;
    disabled?: boolean;
    items: {
      id: string;
      label: string;
      disabled?: boolean;
      destructive?: boolean;
      onselect: () => void;
    }[];
  } = $props();
  function navigate(event: KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const target = event.target as HTMLElement;
    const menu = target.closest('[role="menu"]');
    if (!menu) return;
    event.preventDefault();
    const buttons = [
      ...menu.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    ];
    const current = buttons.indexOf(target as HTMLButtonElement);
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[index]?.focus();
  }
</script>

<Popover {label} trigger={trigger ?? dots} {disabled} role="menu" onkeydown={navigate}>
  {#snippet children(close)}
    {#each items as item (item.id)}
      <button
        type="button"
        role="menuitem"
        disabled={item.disabled}
        style="color: var(--foreground); border-radius: var(--radius-sm);"
        class="block w-full px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent disabled:opacity-50"
        class:!text-[var(--danger-foreground)]={item.destructive}
        onclick={() => {
          close();
          item.onselect();
        }}>{item.label}</button
      >
    {/each}
  {/snippet}
</Popover>

{#snippet dots()}<svg
    class="w-[18px] h-[18px] text-muted-foreground"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    ><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle
      cx="19"
      cy="12"
      r="1.6"
    /></svg
  >{/snippet}
