<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Modal from "../../lib/ui/Modal.svelte";
  import Menu from "../../lib/ui/Menu.svelte";
  import Section from "../../lib/ui/Section.svelte";
  import { personaKey } from "./persona-client.svelte";
  import Disclosure from "../../lib/ui/Disclosure.svelte";
  import PersonaCollection from "./PersonaCollection.svelte";
  import PersonaMetadataDialog from "./PersonaMetadataDialog.svelte";
  import PersonaDetails from "./PersonaDetails.svelte";
  import PersonaPreview from "./PersonaPreview.svelte";
  import PromptList from "./PromptList.svelte";
  import ResourceList from "./ResourceList.svelte";
  import Inheritance from "./Inheritance.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import type { EffectiveResource } from "../../../../server/src/persona-protocol";
  const sessions = useSessions(),
    client = sessions.personas;
  let promptToCustomize = $state<EffectiveResource>();
  let dialog = $state<"create" | "metadata" | "preview" | "advanced">();
  let skillToCustomize = $state<string>();
  let parentResources = $state<EffectiveResource[]>([]);
  const readonly = $derived(!client.view?.writable || client.reading);
  const noReader = $derived(
    !!(client.draft?.skills.length || client.effective?.skills.length) &&
      !sessions.catalog.configurations.some((c) => c.skillReader),
  );
  onMount(() => {
    void client.refresh();
  });
  onDestroy(() => client.collection());
  function newPersona() {
    client.editorError = "";
    dialog = "create";
  }
  function exclude(type: "instructions" | "skills", id: string) {
    if (!client.draft) return;
    const ids = client.draft.exclude[type] ?? [];
    if (!ids.includes(id)) client.draft.exclude[type] = [...ids, id];
    void client.validate();
  }
  function customize(
    type: "instructions" | "skills",
    resource: EffectiveResource,
  ) {
    dialog = undefined;
    if (type === "skills") skillToCustomize = resource.id;
    else promptToCustomize = resource;
  }
</script>

<main
  id="workspace"
  class="flex-1 overflow-y-auto px-8 py-8 bg-white"
  aria-label="Persona management"
>
  <div class="max-w-4xl mx-auto space-y-6 pb-16">
    {#if client.mode === "collection"}
      <PersonaCollection
        {client}
        onnew={newPersona}
        onopen={(ref) => {
          void client.open(ref);
        }}
      />
    {/if}
    <div hidden={client.mode === "collection"}>
      <header class="space-y-4 border-b border-zinc-100 pb-6 persona-heading">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0 space-y-2">
            <h1 class="text-xl font-semibold tracking-tight text-zinc-900 break-words">
              {client.draft?.name ?? client.inspectedSummary?.name ?? "Persona"}
            </h1>
            {#if client.draft?.description}<p
                class="text-xs text-zinc-500 break-words"
              >
                {client.draft.description}
              </p>{/if}
            <p role="status" class="text-xs text-zinc-500">
              {client.reading
                ? "Loading persona…"
                : client.dirty
                  ? "Unsaved changes"
                  : client.hasUnappliedContent
                    ? "Unapplied prompt changes"
                    : client.status}
            </p>
            {#if !client.view?.writable && client.view}<p class="text-xs">
                This persona is read-only.
              </p>{/if}
          </div>
          <div class="flex gap-2">
            <Button
              variant="primary"
              loading={client.busy}
              disabled={!client.dirty || readonly || !client.view?.revision}
              onclick={() => client.save()}>Save changes</Button
            >
            <Menu
              label="Persona actions"
              items={[
                {
                  id: "metadata",
                  label: "Edit name and description",
                  disabled: readonly,
                  onselect: () => (dialog = "metadata"),
                },
                {
                  id: "preview",
                  label: "Preview",
                  disabled: !client.view,
                  onselect: () => (dialog = "preview"),
                },
                {
                  id: "advanced",
                  label: "Advanced settings",
                  disabled: !client.view,
                  onselect: () => (dialog = "advanced"),
                },
                {
                  id: "reload",
                  label: "Reload saved version",
                  disabled: client.busy || !client.view,
                  onselect: () => void client.select(client.view!.ref),
                },
              ]}
            />
          </div>
        </div>
      </header>
      <PersonaDetails
        error={client.editorError}
        context={client.editorErrorContext}
        retainedEdits={client.dirty}
      />
      {#if client.notice}<p role="status" class="text-xs text-zinc-600">
          {client.notice}
        </p>{/if}
      {#if client.inspectedSummary && !client.inspectedSummary.valid}
        <section
          aria-label="Catalog diagnostics"
          class="space-y-2 text-xs break-words"
        >
          <p>
            {client.inspectedSummary.ref.root}/{client.inspectedSummary.ref
              .path}
          </p>
          <PersonaDetails
            diagnostics={client.inspectedSummary.diagnostics.map((d) =>
              d.code === "duplicate-identity"
                ? {
                    ...d,
                    refs: client.items
                      .filter(
                        (item) =>
                          item.ref.id === client.inspectedSummary!.ref.id,
                      )
                      .map((item) => item.ref),
                  }
                : d,
            )}
          />
          {#if !client.view}<p>
              Document unavailable for editing. Repair the original document on
              the backend host; it has not been reconstructed.
            </p>{/if}
        </section>
      {/if}
      {#if client.view && client.draft}
        {#key personaKey(client.view.ref)}
          <div class="space-y-6">
            <Section
              title="Reuse personas"
              description="Start with their resources."
              layout="split"
              class="border-b border-zinc-100 pb-6"
            >
              <Inheritance
                {readonly}
                options={client.items}
                loadContext={client.effective}
                onresources={(resources) => (parentResources = resources)}
                selfId={client.view.ref.id}
                active={client.mode === "editor"}
                onchange={() => void client.validate()}
                bind:parents={client.draft.parents}
                bind:exclude={client.draft.exclude}
              />
            </Section>
            <div
              aria-label="Resource resolution"
              class="text-xs text-zinc-500 space-y-2"
            >
              {#if client.resolving}<p role="status">
                  Updating resources… Last checked resources remain visible.
                </p>
              {:else if !client.resourcesCurrent}<p role="status">
                  Resources not checked for these changes. Showing the last
                  checked resources and local draft.
                </p>{/if}
              <PersonaDetails
                error={client.resolutionError}
                context="draft"
                retainedEdits={client.dirty}
                diagnostics={client.resourcesCurrent
                  ? client.effective?.diagnostics
                  : []}
              />
            </div>
            <Section
              title="Prompts"
              description="Tell the persona how to respond."
              layout="split"
              class="border-b border-zinc-100 pb-6"
            >
              <PromptList
                reference={client.view.ref}
                declared={client.view.definition.instructions?.flatMap((i) =>
                  i.file ? [i.file] : [],
                ) ?? []}
                {readonly}
                {client}
                active={client.mode === "editor"}
                customizeResource={promptToCustomize}
                oncustomizehandled={() => (promptToCustomize = undefined)}
                bind:items={client.draft.instructions}
              />
            </Section>
            <Section
              title="Skills"
              description="Reusable knowledge and workflows."
              layout="split"
              class="border-b border-zinc-100 pb-6"
            >
              <ResourceList
                {readonly}
                reference={client.view.ref}
                options={client.items}
                active={client.mode === "editor"}
                contextKey={`${personaKey(client.view.ref)}/${client.contentContext}`}
                onchange={() => void client.validate()}
                onexclude={(id) => exclude("skills", id)}
                customizeId={skillToCustomize}
                oncustomizehandled={() => (skillToCustomize = undefined)}
                effective={client.effective?.skills ?? []}
                bind:items={client.draft.skills}
              />
              {#if noReader}<p
                  role="status"
                  class="text-xs text-zinc-600 mt-4"
                >
                  Skills need file access. No chat setup currently allows it.
                </p>{/if}
            </Section>
          </div>
        {/key}
      {/if}
    </div>
  </div>
</main>

{#if dialog === "create" || (dialog === "metadata" && client.mode === "editor")}
  <PersonaMetadataDialog
    {client}
    creating={dialog === "create"}
    onclose={() => {
      dialog = undefined;
      if (client.mode === "editor") void client.validate();
    }}
    oncreated={() => {}}
  />
{:else if dialog === "preview" && client.mode === "editor"}
  <PersonaPreview
    {client}
    {readonly}
    options={client.items}
    {parentResources}
    oncustomize={customize}
    onexclude={exclude}
    onclose={() => (dialog = undefined)}
  />
{:else if dialog === "advanced" && client.view && client.mode === "editor"}
  <Modal
    label="Advanced settings"
    title="Advanced settings"
    onclose={() => (dialog = undefined)}
  >
    <p class="text-xs break-all">
      {client.view.ref.root}/{client.view.ref.path} · {client.view.writable
        ? "Managed writable folder"
        : "Read-only source"}
    </p>
    <Disclosure title="Definition details"
      ><dl class="text-xs space-y-2 break-all">
        <dt>Persona ID</dt>
        <dd>{client.view.ref.id}</dd>
        <dt>Definition revision</dt>
        <dd>{client.view.definitionRevision}</dd>
        <dt>Management revision</dt>
        <dd>
          {client.view.revision ??
            "Unavailable — reload to reconcile or repair resources"}
        </dd>
        <dt>Effective revision</dt>
        <dd>{client.view.effectiveRevision ?? "Unavailable"}</dd>
      </dl></Disclosure
    >
    <Disclosure title="View JSON"
      ><section aria-label="Persona JSON">
        <h3 class="text-xs">Actual draft definition</h3>
        <pre class="text-xs overflow-auto max-h-96">{JSON.stringify(
            client.draft,
            null,
            2,
          )}</pre>
      </section></Disclosure
    >
  </Modal>
{/if}
