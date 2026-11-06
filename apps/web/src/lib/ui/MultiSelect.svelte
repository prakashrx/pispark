<script lang="ts">
  import { tick } from "svelte";
  import Selector from "./Selector.svelte";
  import Input from "./Input.svelte";
  import Button from "./Button.svelte";
  let {
    label,
    value = $bindable([]),
    options,
    disabled = false,
    readonly = false,
    loading = false,
    help,
    error,
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
    allowCustom?: boolean;
    validateCustom?: (value: string) => string | undefined;
  } = $props();
  let root: HTMLDivElement;
  let selected = $state("");
  let custom = $state("");
  let customError = $state<string>();
  const id = $props.id();
  const available = $derived(
    options.filter((option) => !value.includes(option.value)),
  );
  $effect(() => {
    if (selected) {
      if (!disabled && !readonly && !value.includes(selected))
        value = [...value, selected];
      selected = "";
    }
  });
  async function remove(item: string, returnFocus = false) {
    if (disabled || readonly || loading) return;
    const index = value.indexOf(item);
    value = value.filter((current) => current !== item);
    if (returnFocus) {
      await tick();
      const chips = root.querySelectorAll<HTMLButtonElement>("li button");
      (
        chips[Math.min(index, chips.length - 1)] ??
        root.querySelector<HTMLButtonElement>(".ui-selector")
      )?.focus();
    }
  }
  function addCustom() {
    if (disabled || readonly || loading) return;
    const token = custom.trim();
    if (!token) return;
    customError = validateCustom?.(token);
    if (customError) return;
    if (!value.includes(token)) value = [...value, token];
    custom = "";
  }
</script>

<div
  bind:this={root}
  role="group"
  aria-labelledby={`${id}-label`}
  aria-describedby={help || error ? `${id}-help` : undefined}
  class="space-y-2 min-w-0"
>
  <span id={`${id}-label`} class="block text-xs font-medium text-neutral-900"
    >{label}</span
  >
  <ul aria-label={`Selected ${label}`} class="flex flex-wrap gap-1.5">
    {#each value as item (item)}
      {@const option = options.find((option) => option.value === item)}
      <li
        class="inline-flex max-w-full items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-700"
      >
        <span class="break-all"
          >{option?.label ?? item}{#if !option}<span class="text-neutral-500">
              (Unavailable)</span
            >{/if}</span
        >
        {#if !readonly}<Button
            variant="ghost"
            size="compact"
            disabled={disabled || loading}
            aria-label={`Remove ${option?.label ?? item}`}
            onkeydown={(event) => {
              if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                remove(item, true);
              }
            }}
            onclick={() => remove(item, true)}>×</Button
          >{/if}
      </li>
    {/each}
  </ul>
  {#if !readonly}
    <Selector
      label={`Add ${label}`}
      options={available}
      bind:value={selected}
      searchable
      display="field"
      {disabled}
      {loading}
      invalid={!!error}
    />
    {#if allowCustom}
      <div class="flex items-start gap-2">
        <Input
          label={`Custom ${label}`}
          bind:value={custom}
          {disabled}
          invalid={!!customError}
          aria-describedby={customError ? `${id}-custom-error` : undefined}
          onkeydown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustom();
            } else if (event.key === "Backspace" && !custom && value.length) {
              event.preventDefault();
              remove(value[value.length - 1]!);
            }
          }}
        />
        <Button {disabled} onclick={addCustom}>Add</Button>
      </div>
      {#if customError}<p
          id={`${id}-custom-error`}
          role="alert"
          class="text-xs text-red-700"
        >
          {customError}
        </p>{/if}
    {/if}
  {/if}
  {#if help || error}<p
      id={`${id}-help`}
      role={error ? "alert" : undefined}
      class="text-xs text-neutral-500"
      class:text-red-700={!!error}
    >
      {error || help}
    </p>{/if}
</div>
