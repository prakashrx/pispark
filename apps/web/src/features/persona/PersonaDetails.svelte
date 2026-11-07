<script lang="ts">
  import Disclosure from "../../lib/ui/Disclosure.svelte";
  import type { PersonaDiagnostic } from "../../../../server/src/persona-protocol";
  import {
    personaError,
    type PersonaErrorContext,
  } from "./persona-presentation";
  let {
    error = "",
    diagnostics = [],
    context = "document",
    retainedEdits = false,
  }: {
    error?: string;
    diagnostics?: PersonaDiagnostic[];
    context?: PersonaErrorContext;
    retainedEdits?: boolean;
  } = $props();
  const reasons = $derived([
    ...new Set([
      ...(error ? [personaError(error, context, retainedEdits)] : []),
      ...diagnostics.map((d) => personaError(d.code)),
    ]),
  ]);
</script>

{#if reasons.length}<div class="text-sm space-y-2 break-words">
    {#each reasons as reason}<p role="alert">{reason}</p>{/each}
    <Disclosure title="Details">
      {#if error}<p class="mt-2">{error}</p>{/if}
      {#each diagnostics as diagnostic}<dl class="mt-2 space-y-1">
          <dt>Code</dt>
          <dd>{diagnostic.code}</dd>
          {#if diagnostic.field}<dt>Field</dt>
            <dd>
              {diagnostic.field}
            </dd>{/if}{#if diagnostic.resourceType || diagnostic.resourceId}<dt>
              Resource
            </dt>
            <dd>
              {diagnostic.resourceType}
              {diagnostic.resourceId ?? ""}
            </dd>{/if}{#each diagnostic.refs ?? [] as ref}<dt>Reference</dt>
            <dd class="break-all">{ref.root}/{ref.path} · {ref.id}</dd>{/each}
        </dl>{/each}
    </Disclosure>
  </div>{/if}
