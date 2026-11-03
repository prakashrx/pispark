<script lang="ts">
  import { onMount } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import PersonaDetails from "./PersonaDetails.svelte";
  import {
    personaName,
    samePersona,
    resourceLabel,
  } from "./persona-presentation";
  import PromptList from "./PromptList.svelte";
  import ResourceList from "./ResourceList.svelte";
  import Inheritance from "./Inheritance.svelte";
  import { personaKey } from "./persona-client.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import type { EffectiveResource } from "../../../../server/src/persona-protocol";
  const sessions = useSessions(),
    client = sessions.personas;
  let newName = $state(""),
    chosen = $state(""),
    inspect = $state(false);
  let parentResources = $state<EffectiveResource[]>([]);
  const readonly = $derived(!client.view?.writable || client.reading);
  const noReader = $derived(
    !!(client.draft?.skills.length || client.effective?.skills.length) &&
      !sessions.catalog.configurations.some((c) => c.skillReader),
  );
  onMount(() => {
    void client.refresh();
  });
  $effect(() => {
    if (client.inspectedSummary)
      chosen = personaKey(client.inspectedSummary.ref);
    else if (client.view) chosen = personaKey(client.view.ref);
  });
  async function select(value: string) {
    const item = client.items.find((p) => personaKey(p.ref) === value);
    if (item) await client.select(item.ref);
    chosen = client.inspectedSummary
      ? personaKey(client.inspectedSummary.ref)
      : client.view
        ? personaKey(client.view.ref)
        : "";
  }
  function exclude(type: "instructions" | "skills", id: string) {
    if (!client.draft) return;
    client.draft.exclude ??= {};
    const ids = client.draft.exclude[type] ?? [];
    if (!ids.includes(id)) client.draft.exclude[type] = [...ids, id];
  }
  function replace(
    type: "instructions" | "skills",
    resource: EffectiveResource,
  ) {
    const draft = client.draft;
    if (!draft || draft[type]?.some((r) => r.id === resource.id)) return;
    if (type === "instructions")
      draft.instructions = [
        ...(draft.instructions ?? []),
        { id: resource.id, text: resource.text ?? "", replace: true },
      ];
    else
      draft.skills = [
        ...(draft.skills ?? []),
        { id: resource.id, directory: "skills/name", replace: true },
      ];
  }
</script>

<main
  id="workspace"
  class="flex-1 overflow-y-auto px-8 py-8 bg-[#ffffff]"
  aria-label="Persona management"
>
  <div class="max-w-4xl mx-auto space-y-8 pb-16">
    <div
      class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-gray-100 persona-heading"
    >
      <div class="space-y-2 min-w-0">
        <p class="text-xs text-neutral-400">Settings / Personas</p>
        <h1 class="text-2xl font-bold tracking-tight text-neutral-900">
          {client.view ? client.view.definition.name : "Personas"}
        </h1>
        <p class="text-xs text-neutral-500">
          Set the instructions and skills a persona brings to a chat. Changes
          apply to new chats.
        </p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <Button
          class="px-3 py-1.5 bg-neutral-900 text-white rounded-lg text-xs"
          disabled={!client.dirty ||
            client.busy ||
            readonly ||
            !client.view?.revision}
          onclick={() => client.save()}>Save persona</Button
        >
      </div>
    </div>
    <div class="space-y-3">
      <div class="flex gap-2 flex-wrap">
        <select
          class="source-input max-w-md"
          aria-label="Choose a persona"
          value={chosen}
          disabled={client.reading}
          onchange={(event) => void select(event.currentTarget.value)}
          ><option value="">Choose a persona</option
          >{#each client.items as item}<option value={personaKey(item.ref)}
              >{item.valid
                ? item.name
                : `Needs attention · ${item.ref.path}`}{item.writable
                ? ""
                : " · Read-only"}</option
            >{/each}</select
        ><Button
          class="source-action"
          disabled={client.loading}
          onclick={() => client.refresh()}>Refresh list</Button
        >
      </div>
      <form
        class="flex gap-2 flex-wrap"
        onsubmit={(event) => {
          event.preventDefault();
          void client.create(newName).then(() => {
            if (!client.editorError) newName = "";
          });
        }}
      >
        <Input
          label="New persona name"
          class="source-input max-w-md"
          placeholder="New persona name"
          bind:value={newName}
          maxlength={120}
        /><Button
          type="submit"
          class="persona-add"
          disabled={client.busy || !newName.trim()}>Create persona</Button
        >
      </form>
      {#if client.loading}<p role="status" class="text-xs">
          Loading personas…
        </p>{:else if !client.items.length}<p class="text-sm text-neutral-500">
          No personas yet. Create a persona, then add instructions and skills.
        </p>{/if}
      <PersonaDetails error={client.error} />
      <PersonaDetails
        error={client.editorError}
        context={client.editorErrorContext}
        retainedEdits={client.dirty}
      />
      {#if client.notice}<p role="status" class="text-xs text-neutral-600">
          {client.notice}
        </p>{/if}
      <p role="status" class="text-xs text-neutral-600">
        {client.reading
          ? "Loading persona…"
          : client.status === "Review saved changes"
            ? client.status
            : client.dirty
              ? "Unsaved changes"
              : client.status}
      </p>
    </div>
    {#if client.inspectedSummary && !client.inspectedSummary.valid}
      <section
        aria-label="Catalog diagnostics"
        class="space-y-2 text-xs break-words"
      >
        <p>
          {client.inspectedSummary.ref.root}/{client.inspectedSummary.ref.path}
        </p>
        <PersonaDetails
          diagnostics={client.inspectedSummary.diagnostics.map((diagnostic) =>
            diagnostic.code === "duplicate-identity"
              ? {
                  ...diagnostic,
                  refs: client.items
                    .filter(
                      (item) => item.ref.id === client.inspectedSummary!.ref.id,
                    )
                    .map((item) => item.ref),
                }
              : diagnostic,
          )}
        />
        {#if !client.view}<p>
            Document unavailable for editing. Repair the original document on
            the backend host; it has not been reconstructed.
          </p>{/if}
      </section>
    {/if}
    {#if client.view && client.draft}
      {#if !client.view.writable}<p class="text-xs">
          This persona is read-only.
        </p>{/if}
      <div class="space-y-3">
        <label class="block text-xs font-semibold text-neutral-700"
          >Name<Input
            label="Name"
            class="source-input mt-1 max-w-md block"
            bind:value={client.draft.name}
            disabled={readonly}
            maxlength={120}
          /></label
        ><label class="block text-xs font-semibold text-neutral-700"
          >Description<Input
            label="Persona description"
            class="source-input mt-1"
            value={client.draft.description ?? ""}
            disabled={readonly}
            maxlength={1024}
            oninput={(event) => {
              client.draft!.description = event.currentTarget.value;
            }}
          /></label
        >
      </div>
      <PromptList
        reference={client.view.ref}
        declared={client.view.definition.instructions?.flatMap((i) =>
          i.file ? [i.file] : [],
        ) ?? []}
        {readonly}
        {client}
        bind:items={client.draft.instructions}
      />
      <ResourceList {readonly} bind:items={client.draft.skills} />
      {#if noReader}<p role="status" class="text-xs text-neutral-600">
          Skills need file access. No chat setup currently allows it.
        </p>{/if}
      <Inheritance
        {readonly}
        options={client.items}
        loadContext={client.effective}
        onresources={(resources) => (parentResources = resources)}
        selfId={client.view.ref.id}
        bind:parents={client.draft.parents}
        bind:exclude={client.draft.exclude}
      />
      <details class="space-y-3 pt-4 border-t border-gray-100">
        <summary class="text-sm font-semibold cursor-pointer">Preview</summary>
        <p class="text-xs text-neutral-500">
          Saved or last checked version. Check changes to update this preview.
        </p>
        <Button
          class="source-action"
          disabled={!client.draft || client.busy || readonly}
          onclick={() => client.validate()}>Check changes</Button
        >
        {#if client.status === "Changes checked. Not saved yet."}<p
            role="status"
            class="text-xs"
          >
            {client.status}
          </p>{/if}
        <PersonaDetails diagnostics={client.effective?.diagnostics} />
        {#each ["instructions", "skills"] as type}
          <h3 class="text-xs font-semibold capitalize">{type}</h3>
          {#each (type === "instructions" ? client.effective?.instructions : client.effective?.skills) ?? [] as resource, index}
            {@const local = samePersona(resource.origin, client.view.ref)}
            {@const label = resourceLabel(resource)}
            <div
              class="border border-gray-200 rounded-lg p-3 text-xs space-y-2"
            >
              <p class="break-words">{index + 1}. {label}</p>
              <p class="text-neutral-500">
                {local
                  ? "This persona"
                  : `From ${personaName(resource.origin, client.items)}`}
              </p>
              {#if resource.description}<p>{resource.description}</p>{/if}
              {#if resource.disableModelInvocation}<p>
                  Available only when explicitly requested.
                </p>{/if}
              {#if resource.text}<details>
                  <summary>Instruction text</summary>
                  <pre
                    class="whitespace-pre-wrap break-words mt-2">{resource.text}</pre>
                </details>{/if}
              <details>
                <summary>Details</summary>
                <dl class="break-all mt-2 space-y-1">
                  <dt>Reference name</dt>
                  <dd>{resource.id}</dd>
                  <dt>Origin</dt>
                  <dd>
                    {resource.origin.root}/{resource.origin.path} · {resource
                      .origin.id}
                  </dd>
                  {#if resource.file || resource.directory}<dt>Path</dt>
                    <dd>{resource.file ?? resource.directory}</dd>{/if}
                  <dt>Route</dt>
                  <dd>{JSON.stringify(resource.routes)}</dd>
                  <dt>Replaced</dt>
                  <dd>{JSON.stringify(resource.replaced)}</dd>
                </dl>
              </details>
              {#if !local && !readonly}<div class="flex gap-2">
                  <Button
                    class="source-action"
                    aria-label={`Customize ${label}`}
                    onclick={() =>
                      replace(type as "instructions" | "skills", resource)}
                    >Customize</Button
                  ><Button
                    class="source-action"
                    aria-label={`Don’t use ${label}`}
                    onclick={() =>
                      exclude(type as "instructions" | "skills", resource.id)}
                    >Don’t use</Button
                  >
                </div>{/if}
            </div>
          {/each}
        {/each}
        {#each client.effective?.excluded ?? [] as resource}
          {@const known = parentResources.find(
            (r) =>
              r.id === resource.id &&
              resource.origins.some((ref) => samePersona(ref, r.origin)),
          )}
          <p class="text-xs">
            Not used · {known
              ? resourceLabel(known)
              : `Reference ${resource.id}`}
          </p>
        {/each}
      </details>
      <details class="space-y-3 text-xs pt-4 border-t border-gray-100">
        <summary class="text-sm font-semibold cursor-pointer">Advanced</summary>
        <div class="space-y-2 text-xs text-neutral-500 break-all">
          <p>
            {client.view.ref.root}/{client.view.ref.path} · {!client.view
              .writable
              ? "Read-only source"
              : "Managed writable folder"}
          </p>
          <p>
            Revision: {client.view.revision?.slice(0, 12) ??
              "Unavailable — reload to reconcile or repair resources"}
          </p>
          <Button
            class="source-action"
            disabled={client.busy}
            onclick={() => client.select(client.view!.ref)}
            >Reload saved version</Button
          >
        </div>
        <dl class="space-y-1 break-all">
          <dt>Persona ID</dt>
          <dd>{client.view.ref.id}</dd>
          <dt>Definition revision</dt>
          <dd>{client.view.definitionRevision}</dd>
          <dt>Management revision</dt>
          <dd>{client.view.revision ?? "Unavailable"}</dd>
          <dt>Effective revision</dt>
          <dd>{client.view.effectiveRevision ?? "Unavailable"}</dd>
        </dl>
        <Button
          class="source-action"
          onclick={() => (inspect = !inspect)}
          aria-expanded={inspect}>View JSON</Button
        >
        {#if inspect}<section aria-label="Persona JSON" class="space-y-2">
            <h2 class="text-sm font-semibold">Actual draft definition</h2>
            <pre
              class="text-xs bg-neutral-50 rounded-xl p-4 overflow-auto max-h-96">{JSON.stringify(
                client.draft,
                null,
                2,
              )}</pre>
          </section>{/if}
      </details>
    {/if}
  </div>
</main>
