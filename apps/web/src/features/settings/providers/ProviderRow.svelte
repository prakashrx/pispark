<script lang="ts">
  import Button from "../../../lib/ui/Button.svelte";
  import type { ProviderInfo } from "./types";
  let {
    provider,
    hasCredential,
    onconnect,
    onmodels,
    ondisconnect,
  }: {
    provider: ProviderInfo;
    hasCredential: boolean;
    onconnect: () => void;
    onmodels: () => void;
    ondisconnect: () => void;
  } = $props();
  const interactive = $derived(
    provider.methods.some((method) => method.interactive),
  );
</script>

<li
  class="p-4 flex items-center justify-between gap-4 form-row"
  aria-label={provider.name}
>
  <div class="min-w-0 flex-1">
    <h3 class="text-xs font-medium text-gray-900">{provider.name}</h3>
    <p class="text-[11px] text-gray-500 mt-1">
      {hasCredential
        ? "Sign-in saved"
        : provider.configured
          ? "Set up on this computer"
          : "Not set up"}
    </p>
    <p class="text-[11px] text-gray-400 mt-1 break-words">
      {provider.methods
        .map(
          (method) =>
            `${method.label}${method.interactive ? "" : " (host setup only)"}`,
        )
        .join(" · ") || "No sign-in method supplied"}
    </p>
  </div>
  <div class="flex flex-wrap items-center gap-2 shrink-0">
    <Button aria-label={`Models for ${provider.name}`} onclick={onmodels}
      >Models <span class="text-gray-400 ml-1">{provider.models.length}</span
      ></Button
    >
    <Button
      aria-label={`${hasCredential ? "Manage" : "Connect"} ${provider.name}`}
      onclick={onconnect}
      unavailable={!interactive
        ? "Host configuration required; no interactive login supplied by Pi"
        : undefined}
      >{interactive
        ? hasCredential
          ? "Manage"
          : "Connect"
        : "Host setup"}</Button
    >
    {#if hasCredential}<Button
        variant="ghost"
        size="compact"
        aria-label={`Disconnect ${provider.name}`}
        onclick={ondisconnect}>Disconnect</Button
      >{/if}
  </div>
</li>
