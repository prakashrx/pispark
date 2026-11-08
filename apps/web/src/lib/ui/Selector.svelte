<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import Button from "./Button.svelte";
  import Input from "./Input.svelte";
  import Icon from "./Icon.svelte";
  export interface Option {
    value: string;
    label: string;
    disabled?: boolean;
  }
  let {
    label,
    options,
    value = $bindable(""),
    native = false,
    searchable = false,
    class: className = "",
    children,
    footer,
    display = "compact",
    disabled = false,
    readonly = false,
    loading = false,
    invalid = false,
    help,
    error,
    placeholder = "Choose an option",
    emptyText = "Nothing to choose yet",
    action = false,
    id: fieldId,
    "aria-describedby": describedby,
  }: {
    label: string;
    options: Option[];
    value?: string;
    native?: boolean;
    searchable?: boolean;
    class?: string;
    children?: Snippet<[string]>;
    footer?: Snippet;
    display?: "field" | "compact";
    disabled?: boolean;
    readonly?: boolean;
    loading?: boolean;
    invalid?: boolean;
    help?: string;
    error?: string;
    placeholder?: string;
    /** Shown in the popup when there are no options at all (not just no matches). */
    emptyText?: string;
    /** An action trigger ("Add …"): its name is the label alone and it never shows a chosen value. */
    action?: boolean;
    id?: string;
    "aria-describedby"?: string;
  } = $props();
  let open = $state(false);
  let alignLeft = $state(false);
  let query = $state("");
  let active = $state(0);
  let root = $state<HTMLDivElement>();
  let search: HTMLInputElement | null = null;
  const id = $props.id();
  let typed = "";
  let typedAt = 0;
  const description = $derived(
    [
      describedby,
      help ? `${id}-help` : undefined,
      error ? `${id}-error` : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined,
  );
  const optionId = (option: Option | undefined) =>
    option ? `${id}-option-${options.indexOf(option)}` : undefined;
  const filtered = $derived(
    options.filter((option) =>
      (option.label + " " + option.value)
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
  );
  const selected = $derived(
    options.find((option) => option.value === value)?.label ??
      (value ? `Unavailable: ${value}` : placeholder),
  );
  function close(returnFocus = false) {
    open = false;
    if (returnFocus) root?.querySelector("button")?.focus();
  }
  async function show() {
    if (disabled || readonly || loading) return;
    query = "";
    active = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    alignLeft = false;
    open = true;
    await tick();
    const popup = root?.querySelector<HTMLElement>("[data-selector-popup]");
    // Open toward the side with room: action triggers usually sit at the start of a row.
    alignLeft = action || (popup?.getBoundingClientRect().left ?? 0) < 8;
    search = root?.querySelector("input") ?? null;
    if (search) search.focus();
    else root?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
  }
  function choose(option: Option) {
    if (option.disabled || disabled || readonly || loading) return;
    value = option.value;
    close(true);
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
    if (event.key === "Tab" && !footer) close();
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const enabled = filtered
        .map((option, index) => (option.disabled ? -1 : index))
        .filter((index) => index >= 0);
      const position = enabled.indexOf(active);
      active =
        (event.key === "Home"
          ? enabled[0]
          : event.key === "End"
            ? enabled.at(-1)
            : enabled[
                Math.max(
                  0,
                  Math.min(
                    enabled.length - 1,
                    position + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                )
              ]) ?? 0;
    }
    if (
      !searchable &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      typed = Date.now() - typedAt > 700 ? event.key : typed + event.key;
      typedAt = Date.now();
      const index = filtered.findIndex(
        (option) =>
          !option.disabled &&
          option.label.toLowerCase().startsWith(typed.toLowerCase()),
      );
      if (index >= 0) active = index;
    }
    root
      ?.querySelector<HTMLElement>(
        `[id="${filtered[active] ? optionId(filtered[active]) : ""}"]`,
      )
      ?.scrollIntoView?.({ block: "nearest" });
    const option = filtered[active];
    if (event.key === "Enter" && option) {
      event.preventDefault();
      choose(option);
    }
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (open && footer && event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  }}
/>
<svelte:document
  onpointerdown={(event) => {
    if (open && !root?.contains(event.target as Node)) close();
  }}
/>
{#if native}
  <select
    id={fieldId}
    aria-label={label}
    aria-invalid={invalid || !!error || undefined}
    aria-describedby={description}
    disabled={disabled || readonly || loading}
    class={`ui-selector ${className}`}
    data-display={display}
    bind:value
  >
    {#if value && !options.some((option) => option.value === value)}<option
        {value}>Unavailable: {value}</option
      >{/if}
    {#if !value}<option value="">{placeholder}</option>{/if}
    {#each options as option}<option
        value={option.value}
        disabled={option.disabled}>{option.label}</option
      >{/each}
  </select>
{:else}
  <div
    class="relative inline-flex min-w-0"
    class:w-full={display === "field"}
    bind:this={root}
    onfocusout={(event) => {
      if (!root?.contains(event.relatedTarget as Node)) close();
    }}
  >
    <Button
      id={fieldId}
      class={`ui-selector ${className}`}
      data-display={display}
      disabled={disabled || loading}
      unavailable={readonly ? "Read-only" : undefined}
      aria-busy={loading || undefined}
      aria-invalid={invalid || !!error || undefined}
      aria-describedby={description}
      aria-label={action ? label : `${label}: ${selected}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={`${id}-list`}
      onclick={() => (open ? close() : show())}
      onkeydown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          show();
        }
      }}
    >
      {#if children}{@render children(selected)}{:else}<span class="truncate"
          >{loading ? "Loading…" : selected}</span
        ><Icon name="chevronDown" class="w-3.5 h-3.5 opacity-60 shrink-0" />{/if}
    </Button>
    {#if open}
      <div
        data-selector-popup
        class={"selector-popup absolute top-full z-50 mt-2 min-w-56 max-w-[85vw] rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-1.5 text-sm text-foreground " +
          (alignLeft ? "left-0" : "right-0")}
      >
        {#if searchable && options.length}
          <Input
            label={`Search ${label}`}
            placeholder="Search…"
            class="mb-1 w-full"
            bind:value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={filtered.length
              ? optionId(filtered[active])
              : undefined}
            oninput={() => {
              active = 0;
            }}
            onkeydown={keydown}
          />
        {/if}
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          tabindex={searchable && options.length ? -1 : 0}
          aria-activedescendant={filtered.length
            ? optionId(filtered[active])
            : undefined}
          onkeydown={keydown}
          class="max-h-56 overflow-auto outline-none"
        >
          {#each filtered as option, index}
            <button
              type="button"
              role="option"
              id={optionId(option)}
              aria-selected={value === option.value}
              tabindex="-1"
              disabled={option.disabled}
              class="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-[var(--muted)] aria-selected:font-medium aria-selected:text-[var(--interactive-text)] disabled:opacity-50"
              class:bg-[var(--muted)]={index === active}
              onclick={() => choose(option)}>{option.label}</button
            >
          {:else}<p class="px-2.5 py-2 text-muted-foreground" role="status">
              {loading
                ? "Loading…"
                : error
                  ? "Options unavailable"
                  : options.length
                    ? "No matches"
                    : emptyText}
            </p>{/each}
        </div>
        {#if footer}<div class="border-t border-[var(--border)] mt-1.5 p-2.5">
            {@render footer()}
          </div>{/if}
      </div>
    {/if}
  </div>
{/if}

{#if help}<p id={`${id}-help`} class="mt-1 text-xs text-neutral-500">
    {help}
  </p>{/if}
{#if error}<p id={`${id}-error`} role="alert" class="mt-1 text-xs text-[var(--danger-foreground)]">
    {error}
  </p>{/if}

<style>
  :global(.ui-selector[data-display="field"]) {
    width: 100%;
    justify-content: space-between;
    border: 1px solid var(--input);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    background: var(--background);
    font-size: 0.875rem;
    color: var(--foreground);
  }
  :global(.selector-popup) {
    box-shadow: var(--shadow-popover);
  }
  :global(.ui-selector[aria-invalid="true"]) {
    border-color: var(--danger);
  }
</style>
