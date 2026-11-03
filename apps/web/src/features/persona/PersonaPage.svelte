<script lang="ts">
  import { onMount } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Section from "../../lib/ui/Section.svelte";
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
  const readonly = $derived(!client.view?.writable || client.reading);
  const noReader = $derived(
    !!client.effective?.skills.length &&
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
          {client.view ? `${client.view.definition.name} Persona` : "Personas"}
        </h1>
        <p class="text-xs text-neutral-500">
          Saves apply to new sessions only. Running agents keep their admitted
          resources.
        </p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <Button
          class="source-action"
          disabled={!client.view}
          onclick={() => (inspect = !inspect)}
          aria-expanded={inspect}>Inspect JSON</Button
        ><Button
          class="source-action"
          disabled={!client.draft || client.busy || readonly}
          onclick={() => client.validate()}>Validate</Button
        ><Button
          class="px-3 py-1.5 bg-neutral-900 text-white rounded-lg text-xs"
          disabled={!client.dirty ||
            client.busy ||
            readonly ||
            !client.view?.revision}
          onclick={() => client.save()}>Save Persona</Button
        >
      </div>
    </div>
    <div class="space-y-3">
      <div class="flex gap-2 flex-wrap">
        <select
          class="source-input max-w-md"
          aria-label="Edit persona"
          value={chosen}
          disabled={client.reading}
          onchange={(event) => void select(event.currentTarget.value)}
          ><option value="">Choose a persona</option
          >{#each client.items as item}<option value={personaKey(item.ref)}
              >{item.name}{item.writable ? "" : " · Read-only"}{item.valid
                ? ""
                : ` · Invalid · ${item.ref.root}/${item.ref.path}`}</option
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
          No personas yet. Create an empty persona, then add instructions and
          existing skill references.
        </p>{/if}
      {#if client.error}<p role="alert" class="text-sm">{client.error}</p>{/if}
      {#if client.editorError}<p role="alert" class="text-sm break-words">
          {client.editorError}
        </p>{/if}
      <p role="status" class="text-xs text-neutral-600">
        {client.reading
          ? "Loading persona…"
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
        {#each client.inspectedSummary.diagnostics as diagnostic}
          <p role="alert">
            {diagnostic.code}
            {diagnostic.field ?? ""}
            {diagnostic.resourceType ?? ""}
            {diagnostic.resourceId ?? ""}
            {#each diagnostic.refs ?? [] as ref}<span class="block break-all"
                >{ref.root}/{ref.path}</span
              >{/each}
          </p>
        {/each}
        {#if !client.view}<p>
            Document unavailable for editing. Repair the original document on
            the backend host; it has not been reconstructed.
          </p>{/if}
      </section>
    {/if}
    {#if client.view && client.draft}
      <div class="space-y-2 text-xs text-neutral-500 break-all">
        <p>
          {client.view.ref.root}/{client.view.ref.path} · {!client.view.writable
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
          >Reload saved persona</Button
        >
      </div>
      <div class="space-y-3">
        <label class="block text-xs font-semibold text-neutral-700"
          >Display name<Input
            label="Display Name"
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
          This host policy does not provide a skill-reading tool. Saved skill
          references do not grant tools.
        </p>{/if}
      <Inheritance
        {readonly}
        options={client.items}
        selfId={client.view.ref.id}
        bind:parents={client.draft.parents}
        bind:exclude={client.draft.exclude}
      />
      <Section
        title="Effective resources"
        description="Last saved or explicitly validated result. Validate after editing to refresh order and provenance."
        class="space-y-3 pt-4 border-t border-gray-100"
      >
        {#each client.effective?.diagnostics ?? [] as diagnostic}<p
            role="alert"
            class="text-xs"
          >
            {diagnostic.code}
            {diagnostic.resourceId ?? ""}
          </p>{/each}
        {#each ["instructions", "skills"] as type}
          <h3 class="text-xs font-semibold capitalize">{type}</h3>
          {#each (type === "instructions" ? client.effective?.instructions : client.effective?.skills) ?? [] as resource, index}<div
              class="border border-gray-200 rounded-lg p-3 text-xs space-y-2"
            >
              <p class="break-all">
                {index + 1}. {resource.id}
                {resource.nativeName ? `· ${resource.nativeName}` : ""} · {resource
                  .origin.root}/{resource.origin.path} · {resource.origin.id ===
                client.view.ref.id
                  ? "Local"
                  : "Inherited"}{resource.replaced.length ? " · Replaced" : ""}
              </p>
              {#if resource.description}<p>
                  {resource.description}
                </p>{/if}{#if resource.disableModelInvocation}<p>
                  Not advertised to the model (native skill metadata).
                </p>{/if}{#if resource.text}<details>
                  <summary>Instruction text</summary>
                  <pre
                    class="whitespace-pre-wrap break-words mt-2">{resource.text}</pre>
                </details>{/if}{#if resource.origin.id !== client.view.ref.id && !readonly}<div
                  class="flex gap-2"
                >
                  <Button
                    class="source-action"
                    onclick={() =>
                      exclude(type as "instructions" | "skills", resource.id)}
                    >Exclude {resource.id}</Button
                  ><Button
                    class="source-action"
                    onclick={() =>
                      replace(type as "instructions" | "skills", resource)}
                    >Replace {resource.id}</Button
                  >
                </div>{/if}
            </div>{/each}
        {/each}
        {#each client.effective?.excluded ?? [] as resource}<p class="text-xs">
            Excluded {resource.type}: {resource.id}
          </p>{/each}
      </Section>
      {#if inspect}<section aria-label="Persona JSON" class="space-y-2">
          <h2 class="text-sm font-semibold">Actual draft definition</h2>
          <pre
            class="text-xs bg-neutral-50 rounded-xl p-4 overflow-auto max-h-96">{JSON.stringify(
              client.draft,
              null,
              2,
            )}</pre>
        </section>{/if}
      <p class="text-xs text-neutral-500 border-t border-gray-100 pt-4">
        Extensions, commands, tool management, remote sources and chat-local
        changes are not managed in this milestone. Existing trusted host policy
        remains in effect.
      </p>
    {/if}
  </div>
</main>
