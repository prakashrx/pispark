<script lang="ts">
  import Modal from "../../lib/ui/Modal.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Disclosure from "../../lib/ui/Disclosure.svelte";
  import PersonaDetails from "./PersonaDetails.svelte";
  import {
    samePersona,
    personaName,
    resourceLabel,
  } from "./persona-presentation";
  import type { PersonaClient } from "./persona-client.svelte";
  import type {
    PersonaSummary,
    EffectiveResource,
  } from "../../../../server/src/persona-protocol";
  let {
    client,
    readonly,
    options,
    parentResources,
    oncustomize,
    onexclude,
    onclose,
  }: {
    client: PersonaClient;
    readonly: boolean;
    options: PersonaSummary[];
    parentResources: EffectiveResource[];
    oncustomize: (
      type: "instructions" | "skills",
      resource: EffectiveResource,
    ) => void;
    onexclude: (type: "instructions" | "skills", id: string) => void;
    onclose: () => void;
  } = $props();
  const state = $derived(
    !client.resourcesCurrent
      ? "Changes not checked"
      : client.dirty
        ? "Checked draft"
        : "Saved version",
  );
</script>

<Modal label="Persona preview" title="Persona preview" size="wide" {onclose}>
  <div class="flex justify-between items-center gap-3">
    <p role="status" class="text-xs">{state}</p>
    <Button
      loading={client.resolving}
      disabled={readonly}
      onclick={() => client.validate()}>Check changes</Button
    >
  </div>
  <PersonaDetails
    error={client.resolutionError || client.editorError}
    context="draft"
    retainedEdits={client.dirty}
    diagnostics={client.effective?.diagnostics}
  />
  {#each ["instructions", "skills"] as type}
    <section class="space-y-3">
      <h3 class="text-xs font-semibold capitalize">{type}</h3>
      {#each (type === "instructions" ? client.effective?.instructions : client.effective?.skills) ?? [] as resource, index}
        {@const local =
          !!client.view && samePersona(resource.origin, client.view.ref)}
        {@const label = resourceLabel(resource)}
        <div class="border border-neutral-200 rounded-xl p-4 space-y-2 text-xs">
          <p class="font-medium break-words">{index + 1}. {label}</p>
          <p class="text-neutral-500">
            {local
              ? "This persona"
              : `From ${personaName(resource.origin, options)}`}
          </p>
          {#if resource.description}<p>{resource.description}</p>{/if}
          {#if resource.disableModelInvocation}<p>
              Available only when explicitly requested.
            </p>{/if}
          {#if resource.text}<Disclosure title="Instruction text"
              ><p class="whitespace-pre-wrap break-words">
                {resource.text}
              </p></Disclosure
            >{/if}
          <Disclosure title="Details"
            ><dl class="break-all space-y-1">
              <dt>Reference name</dt>
              <dd>{resource.id}</dd>
              <dt>Origin</dt>
              <dd>{resource.origin.root}/{resource.origin.path}</dd>
              {#if resource.file || resource.directory}<dt>Path</dt>
                <dd>{resource.file ?? resource.directory}</dd>{/if}
            </dl></Disclosure
          >
          {#if !local && !readonly}<div class="flex gap-2">
              <Button
                aria-label={`Customize ${label}`}
                onclick={() =>
                  oncustomize(type as "instructions" | "skills", resource)}
                >Customize</Button
              ><Button
                aria-label={`Don’t use ${label}`}
                onclick={() =>
                  onexclude(type as "instructions" | "skills", resource.id)}
                >Don’t use</Button
              >
            </div>{/if}
        </div>
      {:else}<p class="text-xs text-neutral-500">
          No {type} in this preview.
        </p>{/each}
    </section>
  {/each}
  {#each client.effective?.excluded ?? [] as resource}
    {@const known = parentResources.find(
      (r) =>
        r.id === resource.id &&
        resource.origins.some((ref) => samePersona(ref, r.origin)),
    )}
    <p class="text-xs">
      Not used · {known ? resourceLabel(known) : `Reference ${resource.id}`}
    </p>
  {/each}
</Modal>
