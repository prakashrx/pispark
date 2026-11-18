<script lang="ts">
  /**
   * Edits one line of text where it is shown (a title, a name): the text is selected; Enter or leaving
   * the field saves, Escape cancels. Saving may fail with a reason, said under the field; the field
   * stays so the person can fix it. Nothing here knows what is being named.
   */
  import { onMount } from "svelte";

  let {
    value,
    label,
    maxlength = 80,
    onsave,
    ondone,
    class: className = "",
  }: {
    value: string;
    label: string;
    maxlength?: number;
    /** Saves the new text; throws (with the reason as its message) when it can't. */
    onsave: (value: string) => Promise<void>;
    /** Editing ended: saved, cancelled, or nothing changed. */
    ondone: () => void;
    class?: string;
  } = $props();
  const id = $props.id();
  // svelte-ignore state_referenced_locally
  let text = $state(value);
  let error = $state("");
  let saving = false;
  let finished = false;
  let input: HTMLInputElement;
  onMount(() => {
    input.focus();
    input.select();
  });
  function finish() {
    if (finished) return;
    finished = true;
    ondone();
  }
  async function save() {
    if (saving || finished) return;
    if (!text.trim() || text.trim() === value.trim()) return finish();
    saving = true;
    try {
      await onsave(text);
      finish();
    } catch (failure) {
      error = (failure as Error).message || "That didn't save.";
      input.focus();
    } finally {
      saving = false;
    }
  }
</script>

<span class="inline-edit {className}">
  <input
    bind:this={input}
    bind:value={text}
    aria-label={label}
    aria-invalid={error ? true : undefined}
    aria-describedby={error ? `${id}-error` : undefined}
    {maxlength}
    onkeydown={(event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void save();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish();
      }
    }}
    onblur={() => void save()}
  />
  {#if error}<span id={`${id}-error`} role="alert" class="error">{error}</span>{/if}
</span>

<style>
  .inline-edit {
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;
  }
  input {
    width: 100%;
    min-width: 0;
    padding: 0.125rem 0.375rem;
    margin: -0.125rem 0;
    border: 1px solid var(--interactive);
    border-radius: var(--radius-sm);
    background: var(--background);
    color: var(--foreground);
    font: inherit;
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--interactive) 20%, transparent);
  }
  .error {
    position: absolute;
    top: calc(100% + 0.375rem);
    left: 0;
    z-index: 10;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--surface-raised, var(--background));
    box-shadow: var(--shadow-popover);
    color: var(--danger-foreground);
    font-size: var(--text-xs);
    font-weight: 400;
    white-space: nowrap;
  }
</style>
