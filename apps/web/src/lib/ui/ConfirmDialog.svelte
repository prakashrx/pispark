<script lang="ts">
  /**
   * Asks before something that can't be undone (design language §3.4, set 7): a short question, what
   * happens, Cancel first and focused, then the action in its own words. A sheet on a phone.
   */
  import Button from "./Button.svelte";
  import Modal from "./Modal.svelte";
  let {
    title,
    text,
    action,
    busy = false,
    onconfirm,
    oncancel,
  }: {
    title: string;
    text: string;
    /** The action's own words: "Delete session", not "OK". */
    action: string;
    busy?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();
</script>

<Modal label={title} {title} size="small" initialFocus="[data-cancel]" {busy} onclose={oncancel}>
  <p class="text-sm">{text}</p>
  {#snippet footer()}
    <Button data-cancel disabled={busy} onclick={oncancel}>Cancel</Button>
    <Button variant="destructive" loading={busy} onclick={onconfirm}>{action}</Button>
  {/snippet}
</Modal>
