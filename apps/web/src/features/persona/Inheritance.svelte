<script lang="ts">
  import { untrack } from "svelte";
  import Checkbox from "../../lib/ui/Checkbox.svelte";
  import Disclosure from "../../lib/ui/Disclosure.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import MultiSelect from "../../lib/ui/MultiSelect.svelte";
  import OrderControls from "./OrderControls.svelte";
  import PersonaDetails from "./PersonaDetails.svelte";
  import type {
    PersonaParent,
    PersonaSummary,
    ResourceSelection,
    PersonaDocument,
    EffectiveResource,
  } from "../../../../server/src/persona-protocol";
  import { personaKey, personaRequest } from "./persona-client.svelte";
  import {
    samePersona,
    resourceLabel,
    personaName,
  } from "./persona-presentation";

  /**
   * Reused personas, edited in place: pick one to add it, expand a card to choose which of
   * its prompts and skills to use, and skip inherited resources by name at the end.
   */
  let {
    parents = $bindable([]),
    exclude = $bindable({}),
    options,
    selfId,
    loadContext,
    readonly = false,
    onresources,
    onchange,
  }: {
    parents: PersonaParent[];
    exclude: ResourceSelection;
    options: PersonaSummary[];
    selfId: string;
    loadContext?: PersonaDocument;
    readonly?: boolean;
    onresources?: (resources: EffectiveResource[]) => void;
    onchange?: () => void;
    /** Retained for callers; reuse no longer opens panels that need hiding. */
    active?: boolean;
  } = $props();

  const types = [
    { key: "instructions", noun: "prompts", title: "Prompts" },
    { key: "skills", noun: "skills", title: "Skills" },
  ] as const;
  type ParentRead = { document?: PersonaDocument; error?: string };
  let reads = $state<Record<string, ParentRead>>({});
  // Keyed by reference so expansion survives draft reloads.
  let expanded = $state(new Set<string>());
  const referenceKey = (p: PersonaParent) =>
    personaKey({ root: p.root, path: p.path, id: p.id });

  let previousContext: PersonaDocument | undefined;
  // Successful child loads/checks supply a new effective document. Checkbox edits and catalog polling do not.
  $effect(() => {
    const context = loadContext;
    const refs = parents
      .slice(0, 8)
      .map((p) => ({ root: p.root, path: p.path, id: p.id }));
    let active = true;
    untrack(() => {
      const previous = context === previousContext ? reads : {};
      previousContext = context;
      reads = Object.fromEntries(
        refs.flatMap((ref) =>
          previous[personaKey(ref)]?.document ||
          previous[personaKey(ref)]?.error
            ? [[personaKey(ref), previous[personaKey(ref)]!]]
            : [],
        ),
      );
      for (const ref of refs) {
        const key = personaKey(ref);
        if (reads[key]) continue;
        reads[key] = {};
        void personaRequest<PersonaDocument>("read", { ref })
          .then((document) => {
            if (active) reads[key] = { document };
          })
          .catch((error: Error) => {
            if (active) reads[key] = { error: error.message };
          });
      }
    });
    return () => {
      active = false;
    };
  });

  $effect(() => {
    const resources = parents.flatMap((parent) => {
      const doc = reads[referenceKey(parent)]?.document;
      return doc ? [...doc.instructions, ...doc.skills] : [];
    });
    untrack(() => onresources?.(resources));
  });

  const validateReference = (value: string) =>
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64
      ? undefined
      : "Use a reference name of up to 64 lowercase letters, numbers and single hyphens.";

  const candidates = $derived(
    options
      .filter(
        (p) =>
          p.valid &&
          p.ref.id !== selfId &&
          !parents.some((r) => samePersona(r, p.ref)),
      )
      .map((p) => ({ value: personaKey(p.ref), label: p.name })),
  );

  function add(key: string) {
    const selected = options.find((p) => personaKey(p.ref) === key);
    if (!selected || readonly || parents.length >= 8) return;
    parents = [...parents, { ...selected.ref }];
    onchange?.();
  }

  function inherited(type: keyof ResourceSelection, parent?: PersonaParent) {
    const resources = parent
      ? (reads[referenceKey(parent)]?.document?.[type] ?? [])
      : parents.flatMap((p) => reads[referenceKey(p)]?.document?.[type] ?? []);
    return [
      ...new Map(
        resources.map((r) => [r.id, { value: r.id, label: resourceLabel(r) }]),
      ).values(),
    ];
  }

  function move(from: number, to: number) {
    const next = [...parents];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    parents = next;
    onchange?.();
  }

  /** Store a selection, collapsing "exactly every available resource" back to "all". */
  function setInclude(
    parent: PersonaParent,
    type: keyof ResourceSelection,
    ids: string[],
  ) {
    const resources = reads[referenceKey(parent)]?.document?.[type] ?? [];
    const selected = new Set(ids);
    parent.include ??= {};
    if (
      resources.length &&
      selected.size === resources.length &&
      resources.every((r) => selected.has(r.id))
    )
      delete parent.include[type];
    else parent.include[type] = [...selected];
    onchange?.();
  }

  function toggle(
    parent: PersonaParent,
    type: keyof ResourceSelection,
    id: string,
    checked: boolean,
  ) {
    const resources = reads[referenceKey(parent)]?.document?.[type] ?? [];
    const selected = new Set(
      parent.include?.[type] ?? resources.map((r) => r.id),
    );
    if (checked) selected.add(id);
    else selected.delete(id);
    setInclude(parent, type, [...selected]);
  }

  function usage(parent: PersonaParent): string {
    const read = reads[referenceKey(parent)];
    if (read?.error) return "Couldn’t read this persona";
    if (!read?.document) return "Loading…";
    return types
      .map(({ key, noun }) => {
        const include = parent.include?.[key];
        const total = read.document![key].length;
        if (include === undefined) return total ? `All ${noun}` : `No ${noun}`;
        if (!include.length) return `No ${noun}`;
        const known = include.filter((id) =>
          read.document![key].some((r) => r.id === id),
        ).length;
        return `${known} of ${total} ${noun}`;
      })
      .join(" · ");
  }

  function toggleExpanded(parent: PersonaParent) {
    const next = new Set(expanded);
    const key = referenceKey(parent);
    if (!next.delete(key)) next.add(key);
    expanded = next;
  }

  const skipped = $derived(
    (exclude.instructions?.length ?? 0) + (exclude.skills?.length ?? 0),
  );
</script>

<div class="space-y-3">
  {#each parents as parent, index (parent)}
    {@const read = reads[referenceKey(parent)]}
    {@const open = expanded.has(referenceKey(parent))}
    {@const panelId = `reuse-${index}-${referenceKey(parent).replace(/[^\w-]/g, "-")}`}
    <article class="reuse-card" aria-label={personaName(parent, options)}>
      <div class="flex items-start gap-3">
        <span class="reuse-avatar" aria-hidden="true"
          >{personaName(parent, options).slice(0, 1).toUpperCase()}</span
        >
        <div class="min-w-0 flex-1">
          <h3 class="text-[0.9375rem] font-medium break-words">
            {personaName(parent, options)}
          </h3>
          <p
            class="text-sm text-muted-foreground"
            class:reuse-warning={!!read?.error}
          >
            {#if read?.error}<Icon name="alert" class="inline h-4 w-4 -mt-0.5 mr-1" />{/if}{usage(parent)}
          </p>
        </div>
        <OrderControls
          {index}
          count={parents.length}
          label={`reused persona ${index + 1}`}
          {move}
          remove={() => {
            parents = parents.filter((p) => p !== parent);
            onchange?.();
          }}
          disabled={readonly}
        />
      </div>
      <button
        type="button"
        class="reuse-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onclick={() => toggleExpanded(parent)}
        ><Icon
          name="chevronRight"
          class={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
        />Choose what to use</button
      >
      {#if open}
        <div id={panelId} class="reuse-body">
          {#if !read || (!read.document && !read.error)}<p
              role="status"
              class="text-sm text-muted-foreground"
            >
              Loading prompts and skills…
            </p>{/if}
          <PersonaDetails
            error={read?.error}
            diagnostics={read?.document?.diagnostics}
          />
          {#if read?.document || read?.error}
            <div class="grid gap-5 sm:grid-cols-2">
              {#each types as { key, noun, title }}
                {@const resources = read.document?.[key] ?? []}
                {@const known = new Set(resources.map((r) => r.id))}
                <fieldset class="min-w-0 space-y-2.5">
                  <legend class="mb-2 text-sm font-medium">{title}</legend>
                  {#each resources as resource}<Checkbox
                      label={resourceLabel(resource)}
                      aria-label={`${index + 1} · ${key} · ${resourceLabel(resource)}`}
                      checked={parent.include?.[key] === undefined ||
                        parent.include[key]!.includes(resource.id)}
                      disabled={readonly}
                      onchange={(event) =>
                        toggle(
                          parent,
                          key,
                          resource.id,
                          event.currentTarget.checked,
                        )}
                    />{:else}{#if read.document}<p class="text-sm text-muted-foreground">
                        This persona has no {noun}.
                      </p>{/if}{/each}
                  <MultiSelect
                    label={`More ${noun} by reference name`}
                    options={[]}
                    allowCustom
                    validateCustom={validateReference}
                    placeholder="Type a reference name…"
                    readonly={readonly}
                    bind:value={
                      () =>
                        (parent.include?.[key] ?? []).filter(
                          (id) => !known.has(id),
                        ),
                      (extra) =>
                        setInclude(parent, key, [
                          ...(
                            parent.include?.[key] ??
                            resources.map((r) => r.id)
                          ).filter((id) => known.has(id)),
                          ...extra,
                        ])
                    }
                  />
                </fieldset>
              {/each}
            </div>
          {/if}
          <p class="text-xs text-subtle break-all">
            {parent.root}/{parent.path} · {parent.id}
          </p>
        </div>
      {/if}
    </article>
  {:else}
    <p class="text-sm text-muted-foreground">
      Not reusing any personas yet. Reuse one to start from its prompts and
      skills.
    </p>
  {/each}

  <div class="flex flex-wrap items-center gap-3">
    <Selector
      label="Reuse a persona"
      action
      searchable
      options={candidates}
      emptyText="No other personas to reuse yet."
      disabled={readonly || parents.length >= 8}
      bind:value={() => "", (key) => add(key)}
      >{#snippet children()}<Icon name="plus" class="h-4 w-4" /><span
          >Reuse a persona</span
        >{/snippet}</Selector
    >
    {#if parents.length >= 8}<p class="text-sm text-muted-foreground">
        Up to 8 personas can be reused.
      </p>{/if}
  </div>

  {#if parents.length || skipped}
    <Disclosure
      title={skipped ? `Skipped resources (${skipped})` : "Skip inherited resources"}
      help="Prompts and skills with these reference names won’t be used, even when a reused persona provides them."
    >
      <div class="grid gap-4 sm:grid-cols-2">
        {#each types as { key, noun }}
          <MultiSelect
            label={`Skipped ${noun}`}
            options={inherited(key)}
            placeholder={`Search ${noun} or type a name…`}
            readonly={readonly}
            allowCustom
            validateCustom={validateReference}
            bind:value={
              () => exclude[key] ?? [],
              (value) => {
                if (value.length) exclude[key] = value;
                else delete exclude[key];
                onchange?.();
              }
            }
          />
        {/each}
      </div>
    </Disclosure>
  {/if}
</div>

<style>
  .reuse-card {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--card);
    padding: 0.875rem 1rem;
  }
  .reuse-avatar {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-sm);
    background: var(--interactive-muted);
    color: var(--interactive-text);
    font-weight: 600;
    font-size: 0.875rem;
  }
  .reuse-warning {
    color: var(--warning-foreground);
  }
  .reuse-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.5rem;
    margin-left: 2.75rem;
    padding: 0.125rem 0.25rem;
    border-radius: var(--radius-sm);
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--interactive-text);
  }
  .reuse-toggle:hover {
    background: var(--muted);
  }
  .reuse-body {
    margin-top: 0.75rem;
    padding-top: 0.875rem;
    border-top: 1px solid var(--border);
    display: grid;
    gap: 1rem;
  }
</style>
