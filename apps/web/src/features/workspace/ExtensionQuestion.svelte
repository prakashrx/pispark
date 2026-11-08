<script lang="ts">
  import { onMount, untrack } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import type { ExtensionDialog } from "../../../../server/src/protocol";

  /** A question an extension asked through Pi's `ctx.ui`; the run waits for the answer. */
  let {
    dialog,
    onanswer,
  }: { dialog: ExtensionDialog; onanswer: (value: string | boolean | null) => void } = $props();

  const titleId = $derived(`question-${dialog.id}`);
  // Each question mounts once (keyed by id); its editor starts from the prefill.
  let text = $state(untrack(() => (dialog.kind === "editor" ? (dialog.prefill ?? "") : "")));
  let now = $state(Date.now());
  $effect(() => {
    if (!dialog.expiresAt) return;
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const seconds = $derived(
    dialog.expiresAt ? Math.max(0, Math.ceil((dialog.expiresAt - now) / 1000)) : undefined,
  );

  // The run waits on this answer, so the question takes focus, as it does in terminal Pi.
  let section = $state<HTMLElement>();
  // Focus goes back where it was once the question is answered.
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    section?.querySelector<HTMLElement>("input, textarea, [data-option], [data-variant='primary']")?.focus();
    return () => {
      const current = document.activeElement;
      if (!current || current === document.body || section?.contains(current)) previous?.focus();
    };
  });
  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onanswer(null);
      return;
    }
    // Arrow keys move between options, as in a terminal list.
    if (dialog.kind !== "select" || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const options = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[data-option]")];
    const index = options.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    options[(index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length]?.focus();
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    onanswer(text);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section bind:this={section} class="question" role="group" aria-labelledby={titleId} onkeydown={keydown}>
  <div class="question-head">
    <p id={titleId} class="question-title">{dialog.title}</p>
    {#if seconds !== undefined}<span class="question-timer" aria-label={`${seconds} seconds left`}>{seconds}s</span>{/if}
  </div>
  {#if dialog.kind === "confirm"}
    {#if dialog.message}<p class="question-message">{dialog.message}</p>{/if}
    <div class="question-actions">
      <Button variant="primary" onclick={() => onanswer(true)}>Yes</Button>
      <Button onclick={() => onanswer(false)}>No</Button>
    </div>
  {:else if dialog.kind === "select"}
    <div class="question-options">
      {#each dialog.options as option, index}
        <button type="button" class="question-option" data-option onclick={() => onanswer(option)}>{option}</button>
      {/each}
    </div>
  {:else}
    <form class="question-form" onsubmit={submit}>
      {#if dialog.kind === "input"}
        <Input bind:value={text} label={dialog.title} placeholder={dialog.placeholder} />
      {:else}
        <Textarea bind:value={text} label={dialog.title} rows={6} monospace />
      {/if}
      <div class="question-actions">
        <Button type="submit" variant="primary">Submit</Button>
      </div>
    </form>
  {/if}
  <Button class="question-dismiss" variant="ghost" size="compact" onclick={() => onanswer(null)}>Dismiss</Button>
</section>

<style>
  .question {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem 1.125rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--card);
    box-shadow: var(--shadow-sm);
  }
  .question-head {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding-right: 5rem;
  }
  .question-title {
    flex: 1;
    margin: 0;
    font-weight: 500;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .question-message {
    margin: 0;
    color: var(--muted-foreground);
    white-space: pre-line;
  }
  .question-timer {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .question-actions {
    display: flex;
    gap: 0.5rem;
  }
  .question-options {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .question-option {
    padding: 0.5rem 0.75rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--foreground);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .question-option:hover {
    background: var(--muted);
  }
  .question-option:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
    background: var(--muted);
  }
  .question-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  :global(.ui-button.question-dismiss) {
    position: absolute;
    top: 0.625rem;
    right: 0.625rem;
  }
</style>
