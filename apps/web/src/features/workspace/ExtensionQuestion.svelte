<script lang="ts">
  import { untrack } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import type { ExtensionDialog } from "../../../../server/src/protocol";
  import PromptFrame from "./PromptFrame.svelte";
  import SelectPrompt from "./SelectPrompt.svelte";

  /**
   * A question an extension asked through Pi's `ctx.ui`; the run waits for the answer. The frame
   * is the same for every kind; each kind's body gets what Pi gave (a title, a message, options, a
   * prefill) and answers with a value, or skips with `null`. A replacement view would take the
   * same input and call the same `onanswer`.
   */
  let {
    dialog,
    onanswer,
  }: { dialog: ExtensionDialog; onanswer: (value: string | boolean | null) => void } = $props();

  // Each question mounts once (keyed by id); its editor starts from the prefill.
  let text = $state(untrack(() => (dialog.kind === "editor" ? (dialog.prefill ?? "") : "")));
  const hints = {
    confirm: "Y yes · N no · Esc skip",
    select: "↑↓ choose · Enter select · 1–9 quick pick · Esc skip",
    input: "Enter to submit · Esc skip",
    editor: "Ctrl+Enter to submit · Esc skip",
  } as const;

  function shortcut(event: KeyboardEvent) {
    if (dialog.kind === "confirm" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key.toLowerCase() === "y") onanswer(true);
      else if (event.key.toLowerCase() === "n") onanswer(false);
      else return;
      event.preventDefault();
    } else if (dialog.kind === "editor" && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onanswer(text);
    }
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    onanswer(text);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onkeydown={shortcut} role="presentation">
  <PromptFrame title={dialog.title} expiresAt={dialog.expiresAt} hint={hints[dialog.kind]} onskip={() => onanswer(null)}>
    {#if dialog.kind === "confirm"}
      {#if dialog.message}<p class="message">{dialog.message}</p>{/if}
      <div class="actions">
        <Button onclick={() => onanswer(true)}>Yes</Button>
        <Button onclick={() => onanswer(false)}>No</Button>
      </div>
    {:else if dialog.kind === "select"}
      <SelectPrompt options={dialog.options} {onanswer} />
    {:else}
      <form class="form" onsubmit={submit}>
        {#if dialog.kind === "input"}
          <Input bind:value={text} label={dialog.title} placeholder={dialog.placeholder} data-autofocus />
        {:else}
          <Textarea bind:value={text} label={dialog.title} rows={8} monospace data-autofocus />
        {/if}
        <div class="actions"><Button type="submit" variant="primary">Submit</Button></div>
      </form>
    {/if}
  </PromptFrame>
</div>

<style>
  .message {
    margin: 0;
    color: var(--muted-foreground);
    white-space: pre-line;
    overflow-wrap: anywhere;
    max-height: 12rem;
    overflow-y: auto;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
</style>
