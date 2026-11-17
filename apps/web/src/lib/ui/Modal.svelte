<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import Button from "./Button.svelte";
  import Icon from "./Icon.svelte";
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
    dismiss,
    primary,
    cancel = "Cancel",
    asking = false,
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
    /** A × in the title bar; by default only when the dialog has no buttons of its own (Escape always closes). */
    dismiss?: boolean;
    /**
     * A form's main action (Save, Create). With it the dialog ends with Cancel and the action; on a phone
     * it is a full-screen sheet with Cancel, the title and the action in its bar (design set 7), and
     * `footer` keeps only what else it offers (Delete), at the bottom.
     */
    primary?: Snippet;
    cancel?: string;
    /** The dialog asks something of its own (a delete confirmation): Cancel and the action step aside. */
    asking?: boolean;
  } = $props();
  const closable = $derived(dismiss ?? (!footer && !primary));
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
  data-form={primary ? "" : undefined}
  onkeydown={keepFocus}
  oncancel={(event) => {
    event.preventDefault();
    if (!busy) onclose();
  }}
  class="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-0 text-foreground shadow-elevation-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm"
>
  {#if title}<header
      class="flex items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-3"
    >
      {#if primary && !asking}<span class="sheet-only"><Button variant="ghost" size="compact" disabled={busy} onclick={onclose}>{cancel}</Button></span>{/if}
      <div class="title">
        <h2 id={`${id}-title`} class="text-base font-semibold">{title}</h2>
        {#if help}<p id={`${id}-help`} class="mt-1 text-sm text-muted-foreground">
            {help}
          </p>{/if}
      </div>
      {#if closable}<Button
          variant="ghost"
          size="icon"
          aria-label="Close dialog"
          disabled={busy}
          onclick={onclose}><Icon name="close" class="h-4 w-4" /></Button
        >{/if}
      {#if primary && !asking}<span class="sheet-only">{@render primary()}</span>{/if}
    </header>{/if}
  <div class="body {title ? 'p-5 space-y-4' : ''}">{@render children()}</div>
  {#if footer || primary}<footer
      class="flex justify-end gap-2 border-t border-[var(--border)] p-4"
    >
      {#if footer}{@render footer()}{/if}
      {#if primary && !asking}<span class="dialog-only flex gap-2"
          ><Button variant="ghost" disabled={busy} onclick={onclose}>{cancel}</Button>{@render primary()}</span
        >{/if}
    </footer>{/if}
</dialog>

<style>
  .sheet-only {
    display: none;
  }
  /* Nothing to offer at the bottom right now (a confirmation is asking in the body). */
  footer:not(:has(*)) {
    display: none;
  }
  dialog[data-size="small"] {
    max-width: 24rem;
  }
  dialog[data-size="wide"] {
    max-width: 48rem;
  }
  /* Compact (phones): a sheet from the bottom; a wide dialog takes the whole screen. */
  @media (max-width: 599.98px) {
    dialog,
    dialog[data-size] {
      margin: auto 0 0;
      width: 100%;
      max-width: none;
      max-height: 85dvh;
      border-width: 1px 0 0;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      padding-bottom: env(safe-area-inset-bottom);
    }
    dialog[data-size="wide"],
    dialog[data-form] {
      margin: 0;
      height: 100dvh;
      max-height: none;
      border-radius: 0;
    }
    /* A form on a phone: Cancel · title · action in the bar; what else it offers at the bottom. */
    dialog[data-form][open] {
      display: flex;
      flex-direction: column;
    }
    dialog[data-form] header {
      padding: 0.5rem 0.75rem;
    }
    dialog[data-form] .title {
      flex: 1;
      text-align: center;
    }
    dialog[data-form] .sheet-only {
      display: contents;
    }
    dialog[data-form] .dialog-only {
      display: none;
    }
    dialog[data-form] .body {
      flex: 1;
      overflow-y: auto;
    }
    dialog[data-form] footer {
      border-top: 0;
    }
    dialog[data-form] footer:not(:has(> :not(.dialog-only))) {
      display: none;
    }
  }
</style>
