<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import Button from "./Button.svelte";
  let {
    label,
    onclose,
    children,
    title,
    help,
    footer,
    size = "normal",
    initialFocus,
    busy = false,
  }: {
    label: string;
    onclose: () => void;
    children: Snippet;
    title?: string;
    help?: string;
    footer?: Snippet;
    size?: "small" | "normal" | "wide";
    initialFocus?: string;
    busy?: boolean;
  } = $props();
  let dialog: HTMLDialogElement;
  const id = $props.id();
  function keepFocus(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>(
        "button, input, select, textarea, a[href], summary, [tabindex]",
      ),
    ].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(":disabled") &&
        !element.closest("[hidden]") &&
        element.getClientRects().length > 0,
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialog)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || document.activeElement === dialog)
    ) {
      event.preventDefault();
      first?.focus();
    }
  }
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const target = initialFocus
      ? dialog.querySelector<HTMLElement>(initialFocus)
      : dialog.querySelector<HTMLElement>(
          "input:not(:disabled), textarea:not(:disabled), select:not(:disabled)",
        );
    (
      target ??
      dialog.querySelector<HTMLElement>("button:not(:disabled)") ??
      dialog
    ).focus();
    return () => {
      dialog.close();
      previous?.focus();
    };
  });
</script>

<dialog
  bind:this={dialog}
  tabindex="-1"
  aria-label={title ? undefined : label}
  aria-labelledby={title ? `${id}-title` : undefined}
  aria-describedby={help ? `${id}-help` : undefined}
  aria-busy={busy || undefined}
  data-size={size}
  onkeydown={keepFocus}
  oncancel={(event) => {
    event.preventDefault();
    if (!busy) onclose();
  }}
  class="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-0 text-foreground shadow-elevation-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm"
>
  {#if title}<header
      class="flex items-start justify-between gap-4 border-b border-neutral-100 p-5"
    >
      <div>
        <h2 id={`${id}-title`} class="text-base font-semibold">{title}</h2>
        {#if help}<p id={`${id}-help`} class="mt-1 text-sm text-muted-foreground">
            {help}
          </p>{/if}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Close dialog"
        disabled={busy}
        onclick={onclose}>×</Button
      >
    </header>{/if}
  <div class={title ? "p-5 space-y-4" : undefined}>{@render children()}</div>
  {#if footer}<footer
      class="flex justify-end gap-2 border-t border-neutral-100 p-4"
    >
      {@render footer()}
    </footer>{/if}
</dialog>

<style>
  dialog[data-size="small"] {
    max-width: 24rem;
  }
  dialog[data-size="wide"] {
    max-width: 48rem;
  }
</style>
