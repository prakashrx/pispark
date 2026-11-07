<script lang="ts">
  import Radio from "../../../lib/ui/Radio.svelte";
  import Input from "../../../lib/ui/Input.svelte";
  import Button from "../../../lib/ui/Button.svelte";
  import type { ProviderInfo } from "./types";
  let {
    provider,
    defaultModel,
    ondefault,
    busy = false,
    error = "",
    onrefresh,
  }: {
    provider: ProviderInfo;
    defaultModel: string;
    ondefault: (id: string) => void;
    busy?: boolean;
    error?: string;
    onrefresh: () => void;
  } = $props();
  let query = $state("");
  const visible = $derived(
    provider.models.filter((model) =>
      (model.name + " " + model.id)
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    ),
  );
</script>

<section class="space-y-3" aria-label={`Models for ${provider.name}`}>
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h4 class="text-sm font-semibold">Models</h4>
      <p class="text-[0.8125rem] text-muted-foreground mt-0.5">
        Pick a default for new chats. Availability isn’t proof of account access.
      </p>
    </div>
    <Button
      size="compact"
      unavailable={busy ? "Provider operation pending" : undefined}
      onclick={onrefresh}>Refresh catalog</Button
    >
  </div>
  {#if provider.models.length > 6}<Input
      label="Search models"
      placeholder={`Search ${provider.models.length} models…`}
      bind:value={query}
    />{/if}
  {#if error}<p class="inline-note" data-tone="danger" role="alert">{error}</p>{/if}
  <fieldset class="model-list">
    <legend class="sr-only">Default model for new chats</legend>
    {#each visible as model}
      <Radio
        label={model.name}
        name={`default-model-${provider.id}`}
        value={model.id}
        disabled={busy || !model.available}
        checked={defaultModel === model.id}
        onchange={() => ondefault(model.id)}
      >
        <span class="block text-xs text-subtle break-all mt-0.5 font-mono"
          >{model.id}</span
        >
        <span class="flex flex-wrap gap-1.5 mt-1.5">
          {#if defaultModel === model.id}<span class="chip" data-tone="accent">Default</span>{/if}
          <span class="chip" data-tone={model.available ? "success" : undefined}
            >{model.available ? "Available" : "Unavailable"}</span
          >
          <span class="chip">{Math.round(model.contextWindow / 1000)}k context</span>
          {#if model.reasoning}<span class="chip">Reasoning</span>{/if}
          {#if model.input.includes("image")}<span class="chip">Image input</span>{/if}
        </span>
      </Radio>
    {:else}<p class="p-4 text-sm text-muted-foreground">
        {provider.models.length
          ? "No matching models. Try a different search."
          : "No models supplied. An authorized native catalog refresh may add models."}
      </p>{/each}
  </fieldset>
  <p class="text-xs text-subtle" role="status">
    {visible.length} of {provider.models.length} models · Existing chats keep their model.
  </p>
</section>

<style>
  .model-list {
    max-height: 24rem;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--background);
  }
  .model-list > :global(:not(legend) + *) {
    border-top: 1px solid var(--border);
  }
  .model-list :global(.ui-radio:has(input:checked)) {
    background: var(--interactive-muted);
  }
  .chip {
    font-size: 0.6875rem;
    font-weight: 500;
    padding: 0.05rem 0.5rem;
    border-radius: var(--radius-full);
    background: var(--muted);
    color: var(--muted-foreground);
  }
  .chip[data-tone="accent"] {
    background: var(--interactive);
    color: var(--interactive-foreground);
  }
  .chip[data-tone="success"] {
    background: var(--success-muted);
    color: var(--success-foreground);
  }
</style>
