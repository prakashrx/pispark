<script lang="ts">
  /**
   * One provider's sign-in, models and saved sign-in, as shown in its dialog: Pi's own steps to sign
   * in (or a note that the host sets it up), the models with the default choice, and Disconnect.
   */
  import Button from "../../../lib/ui/Button.svelte";
  import ProviderConnection from "./ProviderConnection.svelte";
  import ProviderModels from "./ProviderModels.svelte";
  import type { ProviderInfo } from "./types";
  let {
    provider,
    defaultModel,
    busy,
    error,
    onrefreshstatus,
    onrefreshmodels,
    ondefault,
    ondisconnect,
  }: {
    provider: ProviderInfo;
    defaultModel: string;
    busy: boolean;
    error: string;
    onrefreshstatus: () => void;
    onrefreshmodels: () => void;
    ondefault: (id: string) => void;
    ondisconnect: () => Promise<boolean>;
  } = $props();
  let attempt = $state(0);
  let confirming = $state(false);
  const interactive = $derived(provider.methods.some((m) => m.interactive));
</script>

<div class="provider-panel">
  {#if provider.health === "expired"}<p class="inline-note" data-tone="warning" role="status">
      The saved sign-in no longer works. Sign in again to use {provider.name}'s models.
    </p>{/if}
  {#if interactive}
    {#key attempt}<ProviderConnection {provider} onreset={() => attempt++} onchange={onrefreshstatus} />{/key}
  {:else}
    <p class="inline-note" data-tone="info">
      {provider.configured ? "This provider is configured on the backend host." : "Set up this provider on the backend host."} Pi supplies no
      interactive sign-in for it.
    </p>
  {/if}
  <ProviderModels {provider} {defaultModel} {busy} {error} onrefresh={onrefreshmodels} {ondefault} />
  {#if provider.stored}
    <div class="danger-zone">
      {#if confirming}
        <p class="text-sm" role="alert">
          Remove the saved {provider.name} sign-in? This doesn’t revoke provider access or change host configuration. Existing sessions keep their
          model; future requests may need credentials again.
        </p>
        <div class="flex gap-2 shrink-0">
          <Button size="compact" onclick={() => (confirming = false)}>Cancel</Button>
          <Button
            size="compact"
            variant="destructive"
            loading={busy}
            aria-label={`Confirm disconnect ${provider.name}`}
            onclick={async () => {
              if (await ondisconnect()) confirming = false;
            }}
          >
            Disconnect
          </Button>
        </div>
      {:else}
        <div>
          <p class="text-sm font-medium">Saved sign-in</p>
          <p class="text-[0.8125rem] text-muted-foreground">
            Remove the credential PiSpark stored for {provider.name}.
          </p>
        </div>
        <Button size="compact" variant="destructive" aria-label={`Disconnect ${provider.name}`} onclick={() => (confirming = true)}>
          Disconnect
        </Button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .provider-panel {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .danger-zone {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.875rem 1rem;
    border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border));
    border-radius: var(--radius-md);
  }
  @media (max-width: 640px) {
    .danger-zone {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
