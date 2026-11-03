<script lang="ts">
  import { tick } from "svelte";
  import Input from "../../../lib/ui/Input.svelte";
  import Button from "../../../lib/ui/Button.svelte";
  import type { AuthPromptView } from "../../../../../server/src/provider-protocol";
  import { inputClass, primaryClass } from "./types";
  let { prompt, busy, onrespond }: { prompt: AuthPromptView; busy: boolean; onrespond: (id: string, value: string) => Promise<void> } = $props();
  let value = $state("");
  let form = $state<HTMLFormElement>();
  let focused = false;
  $effect(() => { if (!busy && form && !focused) { focused = true; void tick().then(() => form?.querySelector<HTMLElement>("input, select")?.focus()); } });
  const valid = $derived(prompt.type !== "select" || prompt.options.some(option => option.id === value));
  async function submit() { const response = value; value = ""; await onrespond(prompt.id, response); }
</script>
<form bind:this={form} onsubmit={event => { event.preventDefault(); if (!busy && valid) void submit(); }} class="space-y-3">
  <p class="text-xs font-medium">{prompt.message}</p>
  {#if prompt.type === "select"}
    <select aria-label={prompt.message} bind:value class={inputClass} disabled={busy}>
      <option value="" disabled>Choose an option</option>
      {#each prompt.options as option}<option value={option.id}>{option.label}</option>{/each}
    </select>
    {#each prompt.options.filter(option => option.id === value && option.description) as option}<p class="text-xs text-gray-500">{option.description}</p>{/each}
  {:else}
    <Input label={prompt.message} type={prompt.type === "secret" ? "password" : "text"} bind:value maxlength={8192} autocomplete="off" spellcheck={false} placeholder={prompt.placeholder} class={inputClass} disabled={busy} />
  {/if}
  <Button class={primaryClass} type="submit" unavailable={busy || !valid ? "Enter a response to the current prompt" : undefined}>Continue</Button>
</form>
