<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import Button from "./Button.svelte";
  let {
    label,
    children,
    trigger,
    disabled = false,
    role,
    onkeydown,
  }: {
    label: string;
    children: Snippet<[() => void]>;
    trigger?: Snippet;
    disabled?: boolean;
    role?: "menu";
    onkeydown?: (event: KeyboardEvent) => void;
  } = $props();
  let open = $state(false);
  let root: HTMLDivElement;
  let button: HTMLButtonElement | null;
  const id = $props.id();
  function close(returnFocus = true) {
    open = false;
    if (returnFocus) button?.focus();
  }
  async function show() {
    open = true;
    await tick();
    // Content can name its own first focus (e.g. a read-only summary before a destructive action).
    const preferred = root.querySelector<HTMLElement>("[data-popover] [data-autofocus]");
    if (preferred) return preferred.focus();
    root
      .querySelector<HTMLElement>(
        '[data-popover] [role="menuitem"]:not(:disabled), [data-popover] input, [data-popover] button:not(:disabled)',
      )
      ?.focus();
  }
</script>

<svelte:document
  onpointerdown={(event) => {
    if (open && !root.contains(event.target as Node)) close(false);
  }}
/>
<div
  class="relative inline-flex min-w-0"
  bind:this={root}
  onfocusout={(event) => {
    if (open && !root.contains(event.relatedTarget as Node)) close(false);
  }}
  onkeydown={(event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else onkeydown?.(event);
  }}
  role="presentation"
>
  <Button
    variant="ghost"
    size="compact"
    {disabled}
    aria-label={label}
    aria-expanded={open}
    aria-haspopup={role ?? "dialog"}
    aria-controls={id}
    onclick={(event) => {
      button = event.currentTarget;
      open ? close() : show();
    }}
    onkeydown={(event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        button = event.currentTarget;
        show();
      }
    }}
  >
    {#if trigger}{@render trigger()}{:else}{label}{/if}
  </Button>
  {#if open}<div
      {id}
      data-popover
      {role}
      aria-label={label}
      style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:var(--shadow-popover)"
      class="absolute right-0 top-full z-50 mt-1 w-max max-w-[min(20rem,85vw)] p-1"
    >
      {@render children(() => close())}
    </div>{/if}
</div>
