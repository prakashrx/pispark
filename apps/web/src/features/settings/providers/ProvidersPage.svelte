<script lang="ts">
  import Selector from "../../../lib/ui/Selector.svelte";
  import Input from "../../../lib/ui/Input.svelte";
  import Button from "../../../lib/ui/Button.svelte";
  import Segmented from "../../../lib/ui/Segmented.svelte";
  import Section from "../../../lib/ui/Section.svelte";
  import SettingsPage from "../../../lib/ui/SettingsPage.svelte";
  import ProviderRow from "./ProviderRow.svelte";
  import { useSessions } from "../../workspace/session-client.svelte";
  import { providerErrorMessages } from "../../../../../server/src/provider-protocol";
  const client = useSessions().providers;
  let query = $state("");
  let filter = $state("all");
  let expanded = $state<string>();
  let notice = $state("");
  const providers = $derived(client.catalog.providers);
  const defaultChoice = $derived(client.catalog.defaultModel);
  const defaultProvider = $derived(
    providers.find((p) => p.id === defaultChoice?.provider),
  );
  const defaultModel = $derived(
    defaultProvider?.models.find((m) => m.id === defaultChoice?.id),
  );
  const connected = $derived(providers.filter((p) => p.configured).length);
  // Set-up providers first; otherwise keep Pi's catalog order.
  const visible = $derived(
    providers
      .filter(
        (p) =>
          (p.name + " " + p.id)
            .toLowerCase()
            .includes(query.trim().toLowerCase()) &&
          (filter === "all" || p.configured),
      )
      .toSorted((a, b) => Number(b.configured) - Number(a.configured)),
  );
  const modelOptions = $derived(
    providers.flatMap((provider) =>
      provider.models
        .filter((m) => m.available)
        .map((m) => ({
          value: JSON.stringify({ provider: provider.id, id: m.id }),
          label: `${m.name} · ${provider.name}`,
        })),
    ),
  );
  async function setDefault(model: { provider: string; id: string } | null) {
    if (await client.change("/default", { model }))
      notice = model
        ? "Default saved. Used for new chats; existing chats keep their model."
        : "Default cleared.";
  }
  async function disconnect(provider: string) {
    const done = await client.change("/logout", { provider });
    if (done) notice = "Saved sign-in removed.";
    return !!done;
  }
</script>

<SettingsPage
  title="Providers & models"
  description="Connect an account and choose the model new chats start with."
  label="Providers and models"
>
  <Section title="Default model" description="Used for new chats. Existing chats keep their model.">
    <div class="settings-card mt-4 px-5 py-4 flex items-center gap-4 flex-wrap form-row">
      <div class="min-w-0 flex-1">
        <p class="text-[0.9375rem] font-medium break-words">
          {defaultChoice
            ? (defaultModel?.name ?? defaultChoice.id)
            : "No default selected"}
        </p>
        <p class="text-[0.8125rem] text-muted-foreground mt-0.5 break-words">
          {defaultChoice
            ? `${defaultProvider?.name ?? defaultChoice.provider}${defaultModel?.available ? "" : " · unavailable, saved choice retained"}`
            : modelOptions.length
              ? "Choose one of your available models."
              : "Connect a provider below to make models available."}
        </p>
      </div>
      {#if modelOptions.length}<Selector
          label="Default model"
          searchable
          options={modelOptions}
          placeholder="Choose model"
          bind:value={
            () => (defaultChoice ? JSON.stringify(defaultChoice) : ""),
            (value) => void setDefault(value ? JSON.parse(value) : null)
          }
        />{/if}
      {#if defaultChoice}<Button
          variant="ghost"
          unavailable={client.busy ? "Saving settings" : undefined}
          onclick={() => void setDefault(null)}>Clear</Button
        >{/if}
    </div>
  </Section>

  {#if client.catalog.networkBlocked}<p class="inline-note" data-tone="warning" role="status">
      {providerErrorMessages["network-blocked"]}
    </p>{/if}
  {#if client.error && !expanded}<p class="inline-note" data-tone="danger" role="alert">
      {client.error}
    </p>{/if}
  {#if notice}<p class="inline-note" data-tone="success" role="status">{notice}</p>{/if}

  <Section
    title="Providers"
    description="Open a provider to sign in or browse its models. Available models depend on your account."
  >
    <div class="flex gap-3 items-center flex-wrap mt-4 mb-3">
      <div class="flex-1 min-w-[12rem]">
        <Input
          label="Search providers"
          bind:value={query}
          placeholder={`Search ${providers.length} providers…`}
        />
      </div>
      <Segmented
        label="Provider filter"
        bind:value={filter}
        options={[
          { value: "all", label: "All" },
          { value: "configured", label: `Set up · ${connected}` },
        ]}
      />
      <Button
        variant="ghost"
        unavailable={client.loading ? "Loading catalog" : undefined}
        onclick={() => void client.refresh()}>Reload status</Button
      >
    </div>
    <p class="sr-only" role="status">
      {client.loading
        ? "Loading provider catalog…"
        : `${visible.length} of ${providers.length} providers`}
    </p>
    <ul class="settings-card">
      {#each visible as provider (provider.id)}<ProviderRow
          {provider}
          expanded={expanded === provider.id}
          ontoggle={() =>
            (expanded = expanded === provider.id ? undefined : provider.id)}
          defaultModel={defaultChoice?.provider === provider.id
            ? defaultChoice.id
            : ""}
          busy={client.busy}
          error={client.error}
          onrefreshstatus={() => void client.refresh()}
          onrefreshmodels={() =>
            void client.change("/refresh", { provider: provider.id })}
          ondefault={(id) => void setDefault({ provider: provider.id, id })}
          ondisconnect={() => disconnect(provider.id)}
        />{:else}<li class="p-6 text-sm text-muted-foreground">
          {client.loading
            ? "Loading…"
            : providers.length
              ? "No matching providers. Try another search or show all providers."
              : "No provider catalog loaded. Reload status to try again."}
        </li>{/each}
    </ul>
  </Section>
</SettingsPage>
