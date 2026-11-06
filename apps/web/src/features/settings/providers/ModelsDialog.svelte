<script lang="ts">
  import Modal from "../../../lib/ui/Modal.svelte";
  import Radio from "../../../lib/ui/Radio.svelte";
  import Input from "../../../lib/ui/Input.svelte";
  import Button from "../../../lib/ui/Button.svelte";
  import type { ProviderInfo } from "./types";
  let {
    provider,
    defaultModel,
    ondefault,
    onclose,
    busy = false,
    error = "",
    onrefresh,
  }: {
    provider: ProviderInfo;
    defaultModel: string;
    ondefault: (id: string) => void;
    onclose: () => void;
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

<Modal label={`Models for ${provider.name}`} {onclose}>
  <div class="p-6 space-y-4">
    <div>
      <h2 class="text-sm font-semibold">{provider.name} models</h2>
      <p class="text-[11px] text-gray-500 mt-1">
        Pi's known chat catalog. Configured availability is not proof of
        provider access.
      </p>
    </div>
    <Input
      label="Search models"
      placeholder="Search models..."
      bind:value={query}
    />
    <p class="text-[11px] text-gray-500" role="status">
      {visible.length} models · choose a default for new chats
    </p>
    {#if error}<p class="text-xs text-gray-700" role="alert">{error}</p>{/if}
    <Button
      unavailable={busy ? "Provider operation pending" : undefined}
      onclick={onrefresh}>Refresh provider catalog</Button
    >
    <fieldset
      class="max-h-[45dvh] overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100"
    >
      <legend class="sr-only">Default model for new chats</legend>
      {#each visible as model}
        <Radio
          label={model.name}
          name="default-model"
          value={model.id}
          disabled={busy || !model.available}
          checked={defaultModel === model.id}
          onchange={() => ondefault(model.id)}
        >
          <span class="block text-[10px] text-gray-400 break-all mt-0.5"
            >{model.id}</span
          >
          <span class="block text-[11px] text-gray-500 mt-1"
            >{model.available ? "Configured · " : "Unavailable · "}{Math.round(
              model.contextWindow / 1000,
            )}k context{model.reasoning
              ? " · Reasoning"
              : ""}{model.input.includes("image") ? " · Image input" : ""}</span
          >
        </Radio>
      {:else}<p class="p-4 text-xs text-gray-500">
          {provider.models.length
            ? "No matching models. Try a different search."
            : "No models supplied. An authorized native catalog refresh may add models."}
        </p>{/each}
    </fieldset>
    <div class="flex justify-between items-center gap-2">
      <span class="text-[11px] text-gray-400"
        >Used for new chats. Existing chats keep their model.</span
      ><Button onclick={onclose}>Done</Button>
    </div>
  </div>
</Modal>
