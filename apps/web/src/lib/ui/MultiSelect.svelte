<script lang="ts">
  import { tick } from "svelte";
  /**
   * One field for choosing several values: chosen values sit as chips before the text
   * input, typing filters suggestions, Enter adds the highlighted suggestion or (with
   * allowCustom) the typed text. Values without a known option stay visible as unavailable.
   */
  let {
    label,
    value = $bindable([]),
    options,
    disabled = false,
    readonly = false,
    loading = false,
    help,
    error,
    placeholder,
    allowCustom = false,
    validateCustom,
  }: {
    label: string;
    value?: string[];
    options: { value: string; label: string; disabled?: boolean }[];
    disabled?: boolean;
    readonly?: boolean;
    loading?: boolean;
    help?: string;
    error?: string;
    placeholder?: string;
    allowCustom?: boolean;
    validateCustom?: (value: string) => string | undefined;
  } = $props();
  const id = $props.id();
  let root: HTMLDivElement;
  let input = $state<HTMLInputElement>();
  let query = $state("");
  let open = $state(false);
  let active = $state(0);
  let customError = $state<string>();
  const locked = $derived(disabled || readonly || loading);
  const typed = $derived(query.trim());
  const suggestions = $derived(
    options.filter(
      (option) =>
        !value.includes(option.value) &&
        (option.label + " " + option.value)
          .toLowerCase()
          .includes(typed.toLowerCase()),
    ),
  );
  const custom = $derived(
    allowCustom &&
      typed &&
      !value.includes(typed) &&
      !options.some((option) => option.value === typed)
      ? typed
      : "",
  );
  const items = $derived([
    ...suggestions.map((option) => ({ ...option, custom: false })),
    ...(custom ? [{ value: custom, label: `Add “${custom}”`, custom: true }] : []),
  ]);
  const expanded = $derived(open && !locked && (items.length > 0 || !!typed));
  const optionId = (index: number) => `${id}-option-${index}`;
  const describedby = $derived(
    [customError ? `${id}-custom-error` : "", help || error ? `${id}-help` : ""]
      .filter(Boolean)
      .join(" ") || undefined,
  );
  const labelOf = (item: string) =>
    options.find((option) => option.value === item)?.label ?? item;

  function add(item: { value: string; custom: boolean; disabled?: boolean }) {
    if (locked || item.disabled) return;
    if (item.custom) {
      customError = validateCustom?.(item.value);
      if (customError) return;
    }
    if (!value.includes(item.value)) value = [...value, item.value];
    query = "";
    active = 0;
    customError = undefined;
    input?.focus();
  }
  async function remove(item: string, returnFocus = false) {
    if (locked) return;
    const index = value.indexOf(item);
    value = value.filter((current) => current !== item);
    if (returnFocus) {
      await tick();
      const chips = root.querySelectorAll<HTMLButtonElement>("[data-chip-remove]");
      (chips[Math.min(index, chips.length - 1)] ?? input)?.focus();
    }
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) open = true;
      else if (items.length)
        active =
          (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length;
    } else if (event.key === "Enter") {
      // Never submit an enclosing form from a token field.
      event.preventDefault();
      const item = items[active];
      if (item) add(item);
      else if (typed && !allowCustom) customError = "Choose one of the suggestions.";
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      open = false;
    } else if (event.key === "Backspace" && !query && value.length) {
      event.preventDefault();
      remove(value[value.length - 1]!);
    } else if (event.key === "Tab") open = false;
  }
</script>

<div
  bind:this={root}
  role="group"
  aria-labelledby={`${id}-label`}
  class="token-select relative min-w-0 space-y-1.5"
  onfocusout={(event) => {
    if (!root.contains(event.relatedTarget as Node)) open = false;
  }}
>
  <label id={`${id}-label`} for={`${id}-input`} class="block text-sm font-medium text-foreground"
    >{label}</label
  >
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="token-field"
    data-disabled={locked || undefined}
    data-invalid={!!error || !!customError || undefined}
    onclick={(event) => {
      if (event.target === event.currentTarget) input?.focus();
    }}
  >
    <ul aria-label={`Selected ${label}`} class="contents">
      {#each value as item (item)}
        {@const known = options.some((option) => option.value === item)}
        <li class="token-chip" data-unavailable={!known || undefined}>
          <span class="break-all"
            >{labelOf(item)}{#if !known}<span class="token-note">(Unavailable)</span>{/if}</span
          >
          {#if !readonly}<button
              type="button"
              data-chip-remove
              class="token-remove"
              disabled={disabled || loading}
              aria-label={`Remove ${labelOf(item)}`}
              onkeydown={(event) => {
                if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  remove(item, true);
                }
              }}
              onclick={() => remove(item, true)}>×</button
            >{/if}
        </li>
      {/each}
    </ul>
    {#if !readonly}<input
        bind:this={input}
        id={`${id}-input`}
        class="token-input"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={`${id}-list`}
        aria-activedescendant={expanded && items[active] ? optionId(active) : undefined}
        aria-invalid={!!error || !!customError || undefined}
        aria-describedby={describedby}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        placeholder={loading
          ? "Loading…"
          : (placeholder ??
            (allowCustom ? "Search or type a name…" : "Search…"))}
        bind:value={query}
        onfocus={() => (open = true)}
        oninput={() => {
          open = true;
          active = 0;
          customError = undefined;
        }}
        onkeydown={keydown}
      />{:else if !value.length}<span class="text-sm text-muted-foreground">None</span>{/if}
  </div>
  {#if expanded}
    <div id={`${id}-list`} role="listbox" aria-label={label} class="token-popup">
      {#each items as item, index (item.custom ? "custom" : item.value)}
        <div
          id={optionId(index)}
          role="option"
          tabindex="-1"
          aria-selected={index === active}
          aria-disabled={item.disabled || undefined}
          class="token-option"
          data-custom={item.custom || undefined}
          onpointerdown={(event) => event.preventDefault()}
          onpointermove={() => (active = index)}
          onclick={() => add(item)}
          onkeydown={() => {}}
        >
          {item.label}
        </div>
      {:else}<p role="status" class="px-2.5 py-2 text-sm text-muted-foreground">
          No matches
        </p>{/each}
    </div>
  {/if}
  {#if customError}<p
      id={`${id}-custom-error`}
      role="alert"
      class="text-xs text-[var(--danger-foreground)]"
    >
      {customError}
    </p>{/if}
  {#if help || error}<p
      id={`${id}-help`}
      role={error ? "alert" : undefined}
      class="text-xs"
      class:text-muted-foreground={!error}
      class:text-[var(--danger-foreground)]={!!error}
    >
      {error || help}
    </p>{/if}
</div>

<style>
  .token-field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.5rem;
    padding: 0.3125rem 0.5rem;
    border: 1px solid var(--input);
    border-radius: var(--radius);
    background: var(--background);
    cursor: text;
  }
  .token-field:focus-within {
    border-color: var(--ring);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 22%, transparent);
  }
  .token-field[data-invalid] {
    border-color: var(--danger);
  }
  .token-field[data-disabled] {
    opacity: 0.6;
    cursor: default;
  }
  .token-chip {
    display: inline-flex;
    max-width: 100%;
    align-items: center;
    gap: 0.125rem;
    padding: 0.125rem 0.125rem 0.125rem 0.5rem;
    border-radius: var(--radius-sm, 0.375rem);
    background: var(--muted);
    color: var(--foreground);
    font-size: 0.8125rem;
    line-height: 1.4;
  }
  .token-chip[data-unavailable] {
    outline: 1px dashed var(--border-strong, var(--border));
    background: transparent;
  }
  .token-note {
    margin-left: 0.25rem;
    color: var(--muted-foreground);
  }
  .token-remove {
    display: inline-grid;
    place-items: center;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 0.25rem;
    color: var(--muted-foreground);
    font-size: 0.95rem;
    line-height: 1;
  }
  .token-remove:hover,
  .token-remove:focus-visible {
    background: color-mix(in srgb, var(--foreground) 10%, transparent);
    color: var(--foreground);
  }
  .token-input {
    flex: 1 1 8rem;
    min-width: 6rem;
    border: 0;
    outline: 0;
    background: transparent;
    padding: 0.1875rem 0.125rem;
    font-size: 0.875rem;
    color: var(--foreground);
  }
  .token-input:focus-visible {
    /* The whole field shows focus; the bare input inside it must not draw a second ring. */
    outline: none;
    box-shadow: none;
  }
  .token-input::placeholder {
    color: var(--muted-foreground);
  }
  .token-popup {
    position: absolute;
    z-index: 50;
    left: 0;
    right: 0;
    margin-top: 0.25rem;
    max-height: 14rem;
    overflow: auto;
    padding: 0.375rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 0.75rem);
    background: var(--surface-raised);
    box-shadow: var(--shadow-popover);
  }
  .token-option {
    padding: 0.4375rem 0.625rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    cursor: pointer;
  }
  .token-option[aria-selected="true"] {
    background: var(--muted);
  }
  .token-option[data-custom] {
    color: var(--interactive-text);
  }
  .token-option[aria-disabled="true"] {
    opacity: 0.5;
    cursor: default;
  }
</style>
