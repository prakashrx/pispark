<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  let {
    label,
    onclose,
    children,
  }: { label: string; onclose: () => void; children: Snippet } = $props();
  let dialog: HTMLDialogElement;
  function keepFocus(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex="0"]',
      ),
    ].filter(
      (element) =>
        !element.hasAttribute("disabled") &&
        element.getClientRects().length > 0,
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      dialog.close();
      previous?.focus();
    };
  });
</script>

<dialog
  bind:this={dialog}
  aria-label={label}
  onkeydown={keepFocus}
  oncancel={(event) => {
    event.preventDefault();
    onclose();
  }}
  class="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-2xl bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/30 backdrop:backdrop-blur-sm"
>
  {@render children()}
</dialog>
