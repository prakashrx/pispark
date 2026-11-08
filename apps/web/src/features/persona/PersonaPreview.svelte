<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Disclosure from "../../lib/ui/Disclosure.svelte";
  import InlinePanel from "../../lib/ui/InlinePanel.svelte";
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

<InlinePanel
  label="Persona preview"
  title="Persona preview"
  help="What a chat with this persona receives, after reuse, replacements and skips are applied."
  {onclose}
>
  <p role="status" class="preview-state" data-state={state}>{state}</p>
  <PersonaDetails
    error={client.resolutionError || client.editorError}
    context="draft"
    retainedEdits={client.dirty}
    diagnostics={client.effective?.diagnostics}
  />
  {#each ["instructions", "skills"] as type}
    <section class="space-y-2">
      <h3 class="text-sm font-semibold">
        {type === "instructions" ? "Prompts" : "Skills"}
        <span class="font-normal text-muted-foreground">· in the order the agent receives them</span>
      </h3>
      <ol class="preview-list">
        {#each (type === "instructions" ? client.effective?.instructions : client.effective?.skills) ?? [] as resource, index}
          {@const local =
            !!client.view && samePersona(resource.origin, client.view.ref)}
          {@const label = resourceLabel(resource)}
          <li class="preview-item">
            <span class="preview-index" aria-hidden="true">{index + 1}</span>
            <div class="min-w-0 flex-1 space-y-1.5">
              <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p class="font-medium break-words">
                  <span class="sr-only">{index + 1}. </span>{label}
                </p>
                <span class="preview-origin" data-local={local || undefined}
                  >{local
                    ? "This persona"
                    : `From ${personaName(resource.origin, options)}`}</span
                >
              </div>
              {#if resource.description}<p class="text-muted-foreground">
                  {resource.description}
                </p>{/if}
              {#if resource.disableModelInvocation}<p class="text-muted-foreground">
                  Available only when explicitly requested.
                </p>{/if}
              <div class="flex flex-wrap items-start gap-x-5 gap-y-1">
                {#if resource.text}<Disclosure variant="plain" title="Instruction text"
                    ><p class="preview-text">{resource.text}</p></Disclosure
                  >{/if}
                <Disclosure variant="plain" title="Details"
                  ><dl class="preview-details">
                    <dt>Reference name</dt>
                    <dd>{resource.id}</dd>
                    <dt>Origin</dt>
                    <dd>{resource.origin.root}/{resource.origin.path}</dd>
                    {#if resource.file || resource.directory}<dt>Path</dt>
                      <dd>{resource.file ?? resource.directory}</dd>{/if}
                  </dl></Disclosure
                >
              </div>
            </div>
            {#if !local && !readonly}<div class="flex shrink-0 gap-1.5">
                <Button
                  size="compact"
                  aria-label={`Customize ${label}`}
                  onclick={() =>
                    oncustomize(type as "instructions" | "skills", resource)}
                  >Customize</Button
                ><Button
                  size="compact"
                  variant="ghost"
                  aria-label={`Don’t use ${label}`}
                  onclick={() =>
                    onexclude(type as "instructions" | "skills", resource.id)}
                  >Don’t use</Button
                >
              </div>{/if}
          </li>
        {:else}<li class="preview-empty">
            No {type === "instructions" ? "prompts" : "skills"} in this preview.
          </li>{/each}
      </ol>
    </section>
  {/each}
  {#each client.effective?.excluded ?? [] as resource}
    {@const known = parentResources.find(
      (r) =>
        r.id === resource.id &&
        resource.origins.some((ref) => samePersona(ref, r.origin)),
    )}
    <p class="text-sm text-muted-foreground">
      Not used · {known ? resourceLabel(known) : `Reference ${resource.id}`}
    </p>
  {/each}
  {#snippet footer()}<Button variant="ghost" onclick={onclose}>Close preview</Button
    ><Button
      loading={client.resolving}
      disabled={readonly}
      onclick={() => client.validate()}>Check changes</Button
    >{/snippet}
</InlinePanel>

<style>
  .preview-state {
    align-self: flex-start;
    padding: 0.125rem 0.625rem;
    border-radius: var(--radius-full);
    background: var(--muted);
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .preview-state[data-state="Changes not checked"] {
    background: var(--warning-muted);
    color: var(--warning-foreground);
  }
  .preview-list {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--card);
  }
  .preview-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
  }
  .preview-item + .preview-item {
    border-top: 1px solid var(--border);
  }
  .preview-empty {
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }
  .preview-index {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: var(--radius-sm);
    background: var(--muted);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--muted-foreground);
  }
  .preview-origin {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .preview-origin:not([data-local]) {
    color: var(--interactive-text);
  }
  .preview-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 16rem;
    overflow: auto;
    padding: 0.25rem 0.75rem;
    border-left: 2px solid var(--border);
  }
  .preview-details {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 0.75rem;
    overflow-wrap: anywhere;
  }
  .preview-details dt {
    color: var(--muted-foreground);
  }
</style>
