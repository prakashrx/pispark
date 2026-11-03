<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import Button from "./Button.svelte";
  import Input from "./Input.svelte";
  export interface Option {
    value: string;
    label: string;
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
  }: {
    label: string;
    options: Option[];
    value?: string;
    native?: boolean;
    searchable?: boolean;
    class?: string;
    children?: Snippet<[string]>;
    footer?: Snippet;
  } = $props();
  let open = $state(false);
  let alignLeft = $state(false);
  let query = $state("");
  let active = $state(0);
  let root = $state<HTMLDivElement>();
  let search: HTMLInputElement | null = null;
  const id = $props.id();
  const filtered = $derived(
    options.filter((option) =>
      (option.label + " " + option.value)
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
  );
  const selected = $derived(
    options.find((option) => option.value === value)?.label ?? value,
  );
  function close(returnFocus = false) {
    open = false;
    if (returnFocus) root?.querySelector("button")?.focus();
  }
  async function show() {
    query = "";
    active = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    alignLeft = false;
    open = true;
    await tick();
    const popup = root?.querySelector<HTMLElement>("[data-selector-popup]");
    alignLeft = (popup?.getBoundingClientRect().left ?? 0) < 8;
    search = root?.querySelector("input") ?? null;
    if (searchable) search?.focus();
    else root?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
  }
  function choose(option: Option) {
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
      active =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? filtered.length - 1
            : Math.max(
                0,
                Math.min(
                  filtered.length - 1,
                  active + (event.key === "ArrowDown" ? 1 : -1),
                ),
              );
    }
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
  <select aria-label={label} class={className} bind:value>
    {#each options as option}<option value={option.value}>{option.label}</option
      >{/each}
  </select>
{:else}
  <div
    class="relative inline-flex min-w-0"
    bind:this={root}
    onfocusout={(event) => {
      if (!root?.contains(event.relatedTarget as Node)) close();
    }}
  >
    <Button
      class={className}
      aria-label={`${label}: ${selected}`}
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
      {#if children}{@render children(selected)}{:else}{selected}{/if}
    </Button>
    {#if open}
      <div
        data-selector-popup
        class={"absolute top-full z-50 mt-1 min-w-48 max-w-[85vw] rounded-lg border border-gray-200 bg-white p-1 text-xs text-gray-700 shadow-lg " +
          (alignLeft ? "left-0" : "right-0")}
      >
        {#if searchable}
          <Input
            label={`Search ${label}`}
            class="w-full rounded border-gray-200 px-2 py-1 text-xs"
            bind:value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={filtered.length
              ? `${id}-${active}`
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
          tabindex={searchable ? -1 : 0}
          aria-activedescendant={filtered.length
            ? `${id}-${active}`
            : undefined}
          onkeydown={keydown}
          class="max-h-56 overflow-auto outline-none"
        >
          {#each filtered as option, index}
            <button
              type="button"
              role="option"
              id={`${id}-${index}`}
              aria-selected={value === option.value}
              tabindex="-1"
              class="block w-full rounded px-2 py-1.5 text-left hover:bg-gray-100"
              class:bg-gray-100={index === active}
              onclick={() => choose(option)}>{option.label}</button
            >
          {:else}<p class="px-2 py-2" role="status">
              No matching options
            </p>{/each}
        </div>
        {#if footer}<div class="border-t border-gray-100 mt-1 p-2">
            {@render footer()}
          </div>{/if}
      </div>
    {/if}
  </div>
{/if}
