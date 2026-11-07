<script lang="ts">
  import Button from "../../../lib/ui/Button.svelte";
  import ProviderConnection from "./ProviderConnection.svelte";
  import ProviderModels from "./ProviderModels.svelte";
  import type { ProviderInfo } from "./types";
  let {
    provider,
    expanded,
    ontoggle,
    defaultModel,
    busy,
    error,
    onrefreshstatus,
    onrefreshmodels,
    ondefault,
    ondisconnect,
  }: {
    provider: ProviderInfo;
    expanded: boolean;
    ontoggle: () => void;
    defaultModel: string;
    busy: boolean;
    error: string;
    onrefreshstatus: () => void;
    onrefreshmodels: () => void;
    ondefault: (id: string) => void;
    ondisconnect: () => Promise<boolean>;
  } = $props();
  const id = $props.id();
  let summary: HTMLButtonElement;
  // Escape closes the open row (cancelling any sign-in) and returns focus to it.
  function escape(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if ((event.target as HTMLElement).closest('[aria-expanded="true"]:not(.provider-summary), [role="listbox"]'))
      return;
    event.preventDefault();
    ontoggle();
    summary.focus();
  }
  let attempt = $state(0);
  let confirming = $state(false);
  const interactive = $derived(provider.methods.some((m) => m.interactive));
  const status = $derived(
    provider.stored
      ? { label: "Connected", tone: "success" }
      : provider.configured
        ? { label: "Set up on host", tone: "success" }
        : { label: "Not set up", tone: "idle" },
  );
  const available = $derived(provider.models.filter((m) => m.available).length);
</script>

<svelte:window
  onkeydown={(event) => {
    // Focus falls back to the page when a finished sign-in step re-renders.
    if (expanded && (!document.activeElement || document.activeElement === document.body))
      escape(event);
  }}
/>
<li class="provider" aria-label={provider.name} data-expanded={expanded}>
  <button
    bind:this={summary}
    type="button"
    class="provider-summary"
    aria-expanded={expanded}
    aria-controls={`${id}-panel`}
    onclick={ontoggle}
  >
    <span class="avatar" aria-hidden="true">{provider.name.slice(0, 1)}</span>
    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-2 flex-wrap">
        <span class="text-[0.9375rem] font-medium text-foreground">{provider.name}</span>
        <span class="status" data-tone={status.tone}>{status.label}</span>
      </span>
      <span class="block text-[0.8125rem] text-muted-foreground mt-0.5 truncate">
        {provider.models.length} models{available && provider.configured
          ? ` · ${available} available`
          : ""} · {provider.methods.map((m) => m.label).join(" · ") ||
          "No sign-in method supplied"}
      </span>
    </span>
    <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  </button>
  {#if expanded}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div id={`${id}-panel`} class="provider-panel" onkeydown={escape}>
      {#if interactive}
        {#key attempt}<ProviderConnection
            {provider}
            onreset={() => attempt++}
            onchange={onrefreshstatus}
          />{/key}
      {:else}
        <p class="inline-note" data-tone="info">
          This provider is configured on the backend host; Pi supplies no
          interactive sign-in for it.
        </p>
      {/if}
      <ProviderModels
        {provider}
        {defaultModel}
        {busy}
        {error}
        onrefresh={onrefreshmodels}
        {ondefault}
      />
      {#if provider.stored}
        <div class="danger-zone">
          {#if confirming}
            <p class="text-sm" role="alert">
              Remove the saved {provider.name} sign-in? This doesn’t revoke
              provider access or change host configuration. Existing chats keep
              their model; future requests may need credentials again.
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
                }}>Disconnect</Button
              >
            </div>
          {:else}
            <div>
              <p class="text-sm font-medium">Saved sign-in</p>
              <p class="text-[0.8125rem] text-muted-foreground">
                Remove the credential PiSpark stored for {provider.name}.
              </p>
            </div>
            <Button
              size="compact"
              variant="destructive"
              aria-label={`Disconnect ${provider.name}`}
              onclick={() => (confirming = true)}>Disconnect</Button
            >
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</li>

<style>
  :global(.provider + .provider) {
    border-top: 1px solid var(--border);
  }
  .provider-summary {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.875rem;
    padding: 0.875rem 1.25rem;
    text-align: left;
    background: transparent;
    border: 0;
    transition: background 0.12s;
  }
  .provider-summary:hover {
    background: color-mix(in srgb, var(--muted) 60%, transparent);
  }
  .provider-summary:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    flex-shrink: 0;
    border-radius: var(--radius);
    background: var(--muted);
    color: var(--foreground);
    font-weight: 650;
    font-size: 0.9375rem;
  }
  [data-expanded="true"] .avatar {
    background: var(--interactive);
    color: var(--interactive-foreground);
  }
  .status {
    font-size: 0.6875rem;
    font-weight: 500;
    padding: 0.05rem 0.5rem;
    border-radius: var(--radius-full);
    background: var(--muted);
    color: var(--muted-foreground);
  }
  .status[data-tone="success"] {
    background: var(--success-muted);
    color: var(--success-foreground);
  }
  .chevron {
    width: 1.125rem;
    height: 1.125rem;
    color: var(--subtle-foreground);
    transition: transform 0.15s;
  }
  [data-expanded="true"] .chevron {
    transform: rotate(180deg);
  }
  .provider-panel {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 0.5rem 1.25rem 1.5rem 4.375rem;
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
    .provider-panel {
      padding-left: 1.25rem;
    }
    .danger-zone {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
