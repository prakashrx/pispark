<script lang="ts">
  import Selector from "../../../lib/ui/Selector.svelte";
  import Input from "../../../lib/ui/Input.svelte";
  import Button from "../../../lib/ui/Button.svelte";
  import Modal from "../../../lib/ui/Modal.svelte";
  import Section from "../../../lib/ui/Section.svelte";
  import ProviderRow from "./ProviderRow.svelte";
  import ConnectionDialog from "./ConnectionDialog.svelte";
  import ModelsDialog from "./ModelsDialog.svelte";
  import { useSessions } from "../../workspace/session-client.svelte";
  import { providerErrorMessages } from "../../../../../server/src/provider-protocol";
  import type { ProviderInfo } from "./types";
  const client = useSessions().providers;
  let query = $state("");
  let filter = $state("all");
  let selected = $state<ProviderInfo>();
  let dialog = $state<"connect" | "models" | "disconnect">();
  let notice = $state("");
  const providers = $derived(client.catalog.providers);
  const defaultChoice = $derived(client.catalog.defaultModel);
  const defaultProvider = $derived(
    providers.find((p) => p.id === defaultChoice?.provider),
  );
  const defaultModel = $derived(
    defaultProvider?.models.find((m) => m.id === defaultChoice?.id),
  );
  const visible = $derived(
    providers.filter(
      (p) =>
        (p.name + " " + p.id)
          .toLowerCase()
          .includes(query.trim().toLowerCase()) &&
        (filter === "all" || p.configured),
    ),
  );
  const current = $derived(
    providers.find((p) => p.id === selected?.id) ?? selected,
  );
  function open(provider: ProviderInfo, kind: typeof dialog) {
    selected = provider;
    dialog = kind;
  }
  function close() {
    dialog = undefined;
  }
  async function disconnect(provider: string) {
    if (await client.change("/logout", { provider })) {
      notice = "Saved sign-in removed.";
      if (selected?.id === provider && dialog === "disconnect") close();
    }
  }
</script>

<main
  id="workspace"
  aria-label="Providers and models"
  class="flex-1 overflow-y-auto px-8 py-8 bg-white"
>
  <div class="max-w-3xl mx-auto space-y-6 pb-20">
    <div class="border-b border-zinc-100 pb-5">
      <h1 class="text-xl font-semibold tracking-tight text-zinc-900">
        Providers &amp; models
      </h1>
      <p class="text-sm text-zinc-500 mt-1">
        Connect an account and choose models for your chats.
      </p>
    </div>
    <div class="flex items-center justify-between gap-3 form-row">
      <div class="min-w-0">
        <h2 class="text-xs font-medium text-zinc-900">Default model</h2>
        <p class="text-[11px] text-zinc-500 mt-1 break-words">
          {defaultChoice
            ? `${defaultModel?.name ?? defaultChoice.id} · ${defaultProvider?.name ?? defaultChoice.provider}${defaultModel?.available ? "" : " · unavailable, saved choice retained"}`
            : "Not selected. Browse a provider’s models to choose."}
        </p>
      </div>
      {#if defaultChoice}<Button
          unavailable={client.busy ? "Saving settings" : undefined}
          onclick={() => void client.change("/default", { model: null })}
          >Clear</Button
        >{/if}
    </div>
    {#if client.catalog.networkBlocked}<p
        class="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg p-3"
        role="status"
      >
        {providerErrorMessages["network-blocked"]}
      </p>{/if}
    {#if client.error}<p class="text-xs text-zinc-700" role="alert">
        {client.error}
      </p>{/if}
    <Section
      variant="settings"
      title="Providers"
      description="Available models depend on your account."
      class="space-y-4"
    >
      <div class="flex gap-3 items-center form-row">
        <div class="flex-1 min-w-0">
          <Input
            label="Search providers"
            bind:value={query}
            placeholder="Search providers..."
          />
        </div>
        <Selector
          label="Provider filter"
          bind:value={filter}
          options={[
            { value: "all", label: "All providers" },
            { value: "configured", label: "Set up" },
          ]}
        /><Button
          unavailable={client.loading ? "Loading catalog" : undefined}
          onclick={() => void client.refresh()}>Reload status</Button
        >
      </div>
      <p class="text-[11px] text-zinc-400" role="status">
        {client.loading
          ? "Loading provider catalog…"
          : `${visible.length} of ${providers.length} providers`}
      </p>
      <ul
        class="border border-zinc-200/80 rounded-xl divide-y divide-zinc-100 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
      >
        {#each visible as provider (provider.id)}<ProviderRow
            {provider}
            hasCredential={provider.stored}
            onconnect={() => open(provider, "connect")}
            onmodels={() => open(provider, "models")}
            ondisconnect={() => open(provider, "disconnect")}
          />{:else}<li class="p-5 text-xs text-zinc-500">
            {client.loading
              ? "Loading…"
              : providers.length
                ? "No matching providers. Try another search or show all providers."
                : "No provider catalog loaded. Reload status to try again."}
          </li>{/each}
      </ul>
    </Section>
    <p class="text-[11px] text-zinc-400">
      Used for new chats. Existing chats keep their model.
    </p>
    <p class="text-xs text-zinc-500" role="status">{notice}</p>
  </div>
</main>
{#if current && dialog === "connect"}<ConnectionDialog
    provider={current}
    onclose={close}
    onchange={() => void client.refresh()}
  />
{:else if current && dialog === "models"}<ModelsDialog
    provider={current}
    defaultModel={defaultChoice?.provider === current.id
      ? defaultChoice.id
      : ""}
    busy={client.busy}
    error={client.error}
    onrefresh={() => void client.change("/refresh", { provider: current!.id })}
    ondefault={(id) => {
      const provider = current!.id;
      void client
        .change("/default", { model: { provider, id } })
        .then((saved) => {
          if (saved)
            notice = "Used for new chats. Existing chats keep their model.";
        });
    }}
    onclose={close}
  />
{:else if current && dialog === "disconnect"}<Modal
    label={`Disconnect ${current.name}`}
    onclose={close}
    ><div class="p-6 space-y-4">
      <h2 class="text-sm font-semibold">Disconnect {current.name}?</h2>
      <p class="text-xs text-zinc-600">
        Disconnect removes only the stored PiSpark credential. It does not
        revoke provider access or remove host or model configuration. Existing
        chats keep their model but future requests may need credentials again.
        The default is retained, even if unavailable.
      </p>
      {#if client.error}<p role="alert" class="text-xs">{client.error}</p>{/if}
      <div class="flex justify-end gap-2">
        <Button onclick={close}>Cancel</Button><Button
          variant="primary"
          unavailable={client.busy ? "Removing credential" : undefined}
          onclick={() => void disconnect(current!.id)}>Disconnect</Button
        >
      </div>
    </div></Modal
  >{/if}
