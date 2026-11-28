<script lang="ts">
  /**
   * Settings → Providers & models (set 6): the model new sessions use, and your providers. A
   * provider opens in a dialog (sign in again, its models, Disconnect); + adds one (set 7: choose,
   * then Pi's own sign-in steps).
   */
  import { onMount } from "svelte";
  import { modelKey } from "../provider-client.svelte";
  import Button from "../../../lib/ui/Button.svelte";
  import Card from "../../../lib/ui/Card.svelte";
  import CardRow from "../../../lib/ui/CardRow.svelte";
  import Icon from "../../../lib/ui/Icon.svelte";
  import IdentityMark from "../../../lib/ui/IdentityMark.svelte";
  import Input from "../../../lib/ui/Input.svelte";
  import Modal from "../../../lib/ui/Modal.svelte";
  import Selector from "../../../lib/ui/Selector.svelte";
  import ProviderPanel from "./ProviderPanel.svelte";
  import { useSessions } from "../../workspace/session-client.svelte";
  import { providerErrorMessages } from "../../../../../server/src/contract/provider-protocol";
  import type { ProviderInfo } from "./types";

  const client = useSessions().providers;
  // Opening Providers tries each saved sign-in, so one that no longer works says so (set 6/2).
  onMount(() => void client.refresh({ check: true }));
  let notice = $state("");
  /** The provider open in its dialog. */
  let open = $state<string>();
  /** Adding a provider: choosing one (true), or signing in to the chosen one. */
  let adding = $state<true | string>();
  let query = $state("");

  const providers = $derived(client.catalog.providers);
  const yours = $derived(providers.filter((p) => p.configured));
  const others = $derived(
    providers.filter((p) => !p.configured && (p.name + " " + p.id).toLowerCase().includes(query.trim().toLowerCase())),
  );
  const defaultChoice = $derived(client.catalog.defaultModel);
  const defaultProvider = $derived(providers.find((p) => p.id === defaultChoice?.provider));
  const defaultModel = $derived(defaultProvider?.models.find((m) => m.id === defaultChoice?.id));
  const modelOptions = $derived(client.modelOptions);
  const opened = $derived(providers.find((p) => p.id === open));
  const chosen = $derived(typeof adding === "string" ? providers.find((p) => p.id === adding) : undefined);

  const available = (provider: ProviderInfo) => provider.models.filter((m) => m.available).length;
  const summary = (provider: ProviderInfo) =>
    provider.stored
      ? `${available(provider)} models`
      : provider.configured
        ? `Set up on the host · ${available(provider)} models`
        : "Not set up";

  async function setDefault(model: { provider: string; id: string } | null) {
    if (await client.change("/default", { model }))
      notice = model ? "Default saved. Used for new sessions; existing sessions keep their model." : "Default cleared.";
  }
  async function disconnect(provider: string) {
    const done = await client.change("/logout", { provider });
    if (done) notice = "Saved sign-in removed.";
    return !!done;
  }
  function closeAdding() {
    adding = undefined;
    query = "";
  }
</script>

{#snippet panel(provider: ProviderInfo)}
  <ProviderPanel
    {provider}
    defaultModel={defaultChoice?.provider === provider.id ? defaultChoice.id : ""}
    busy={client.busy}
    error={client.error}
    onrefreshstatus={() => void client.refresh({ check: true })}
    onrefreshmodels={() => void client.change("/refresh", { provider: provider.id })}
    ondefault={(id) => void setDefault({ provider: provider.id, id })}
    ondisconnect={() => disconnect(provider.id)}
  />
{/snippet}

{#if client.catalog.networkBlocked || (client.error && !open && !adding) || notice}
  <div class="notes">
    {#if client.catalog.networkBlocked}<p class="inline-note" data-tone="warning" role="status">
        {providerErrorMessages["network-blocked"]}
      </p>{/if}
    {#if client.error && !open && !adding}<div class="error">
        <p class="inline-note flex-1" data-tone="danger" role="alert">{client.error}</p>
        <Button variant="ghost" unavailable={client.loading ? "Loading catalog" : undefined} onclick={() => void client.refresh()}>
          Reload status
        </Button>
      </div>{/if}
    {#if notice}<p class="inline-note" data-tone="success" role="status">{notice}</p>{/if}
  </div>
{/if}

<Card title="Default model">
  <CardRow label="New sessions use">
    {#if modelOptions.length}<Selector
        label="Default model"
        searchable
        options={modelOptions}
        placeholder="Choose model"
        bind:value={() => (defaultChoice ? modelKey(defaultChoice) : ""), (value) => void setDefault(value ? JSON.parse(value) : null)}
      />
    {:else}<span class="muted">Connect a provider to make models available.</span>{/if}
  </CardRow>
  <CardRow>
    <p class="muted small">
      {#if defaultChoice && !defaultModel?.available}{defaultModel?.name ?? defaultChoice.id} is unavailable; the saved choice is kept.
      {/if}Existing sessions keep their model.
      {#if defaultChoice}<button type="button" class="link" disabled={client.busy} onclick={() => void setDefault(null)}>
          Clear the default
        </button>{/if}
    </p>
  </CardRow>
</Card>

<Card title="Your providers" count={String(yours.length)}>
  {#snippet action()}
    <button type="button" class="icon" aria-label="Add a provider" title="Add a provider" onclick={() => (adding = true)}>
      <Icon name="plus" class="h-4 w-4" />
    </button>
  {/snippet}
  {#each yours as provider (provider.id)}
    <button type="button" class="provider" onclick={() => (open = provider.id)}>
      <IdentityMark name={provider.name} />
      <span class="name">{provider.name}</span>
      {#if provider.health === "expired"}<span class="expired small">! Sign-in expired</span>
      {:else}<span class="muted small">✓ {summary(provider)}</span>{/if}
      <span class="grow"></span>
      <Icon name="chevronRight" class="h-4 w-4 text-muted-foreground" />
    </button>
  {:else}
    <CardRow>
      <p class="muted">
        {client.loading
          ? "Loading…"
          : providers.length
            ? "None yet. Add one to sign in and use its models."
            : "No provider catalog loaded. Reload status to try again."}
      </p>
    </CardRow>
  {/each}
</Card>
<p class="sr-only" role="status">{client.loading ? "Loading provider catalog…" : `${yours.length} providers set up`}</p>

{#if opened}
  <Modal label={opened.name} title={opened.name} size="wide" onclose={() => (open = undefined)}>
    {@render panel(opened)}
  </Modal>
{/if}

{#if adding}
  <Modal label="Add a provider" title="Add a provider" size="wide" onclose={closeAdding}>
    {#if chosen}
      <button type="button" class="back" onclick={() => (adding = true)}><Icon name="back" class="h-4 w-4" />All providers</button>
      <p class="choose-title">Sign in to {chosen.name}</p>
      {@render panel(chosen)}
    {:else}
      <div class="search">
        <div class="flex-1"><Input label="Search providers" bind:value={query} placeholder={`Search ${others.length} providers…`} /></div>
        <Button variant="ghost" unavailable={client.loading ? "Loading catalog" : undefined} onclick={() => void client.refresh()}>
          Reload status
        </Button>
      </div>
      <ul class="choices" aria-label="Providers">
        {#each others as provider (provider.id)}<li>
            <button type="button" class="provider" onclick={() => (adding = provider.id)}>
              <IdentityMark name={provider.name} />
              <span class="min-w-0 flex-1">
                <span class="name block">{provider.name}</span>
                <span class="muted small block truncate">
                  {provider.models.length} models · {provider.methods.map((m) => m.label).join(" · ") || "Set up on the host"}
                </span>
              </span>
              <Icon name="chevronRight" class="h-4 w-4 text-muted-foreground" />
            </button>
          </li>{:else}<li class="muted p-3">No matching providers.</li>{/each}
      </ul>
    {/if}
  </Modal>
{/if}

<style>
  .notes {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  /* With its "!" mark, so it never rests on colour alone. */
  .expired {
    font-weight: 600;
    color: var(--warning-foreground, var(--foreground));
  }
  .muted {
    color: var(--muted-foreground);
  }
  .small {
    font-size: var(--text-xs);
  }
  .provider {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    min-height: 2.75rem;
    padding: 0.5rem 0.75rem 0.5rem 1rem;
    text-align: left;
    font-size: var(--text-sm);
  }
  .provider:hover {
    background: var(--accent);
  }
  .name {
    font-weight: 500;
  }
  .grow {
    flex: 1;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
  }
  .icon:hover {
    background: var(--accent);
    color: var(--foreground);
  }
  .choices {
    max-height: 50dvh;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .choices li + li {
    border-top: 1px solid var(--border);
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .search {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
  }
  .link {
    margin-left: 0.25rem;
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .choose-title {
    font-weight: 600;
  }
</style>
