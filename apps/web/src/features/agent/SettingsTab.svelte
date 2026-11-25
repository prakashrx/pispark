<script lang="ts">
  /**
   * An agent's settings: what it builds on, its app home view, where it's stored, and deleting it.
   * Each change saves at once.
   */
  import Icon from "../../lib/ui/Icon.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import ConfirmDialog from "../../lib/ui/ConfirmDialog.svelte";
  import type { AgentDefinition } from "../../../../server/src/contract/agent-protocol";
  import type { AgentPage } from "./agent-page.svelte";

  let { page, id }: { page: AgentPage; id: string } = $props();
  const client = $derived(page.client);
  const view = $derived(page.view!);
  const definition = $derived(view.definition);
  const readOnly = $derived(page.readOnly);
  const name = $derived(definition.name ?? id);

  // Settings.
  const base = $derived(definition?.base ?? []);
  const nameOf = (agent: string) => client.items.find((p) => p.id === agent)?.name ?? agent;
  const parentOptions = $derived(client.items.filter((p) => !p.builtIn && p.id !== id && !base.includes(p.id)).map((p) => ({ value: p.id, label: p.name })));
  let addParent = $state("");
  $effect(() => {
    if (!addParent) return;
    const parent = addParent;
    addParent = "";
    void client.updateDefinition((d) => ({ ...d, base: [...(d.base ?? []), parent] }));
  });
  function removeParent(parent: string) {
    void client.updateDefinition((d) => {
      const next: AgentDefinition = { ...d, base: (d.base ?? []).filter((p) => p !== parent) };
      if (!next.base?.length) delete next.base;
      return next;
    });
  }
  let home = $state("");
  let savedHome: string | undefined;
  $effect(() => {
    const next = definition?.home ?? "";
    if (next === savedHome) return;
    savedHome = next;
    home = next;
  });
  function setHome() {
    const key = home.trim();
    void client.updateDefinition((d) => {
      const next: AgentDefinition = { ...d, home: key };
      if (!key) delete next.home;
      return next;
    });
  }
  let askingDelete = $state(false);
</script>

<div class="settings">
  <section class="setting">
    <div class="setting-text">
      <h2 class="setting-title">Builds on</h2>
      <p class="setting-sub">It starts with everything these agents have, then adds its own. Later ones win.</p>
    </div>
    <div class="chips">
      <span class="chip" title="Every agent starts from Default.">Default</span>
      {#each base as parent (parent)}
        <span class="chip">{nameOf(parent)}{#if !readOnly}<button type="button" class="chip-x" aria-label={`Stop building on ${nameOf(parent)}`} disabled={client.busy} onclick={() => removeParent(parent)}><Icon name="close" class="h-3 w-3" /></button>{/if}</span>
      {/each}
      {#if parentOptions.length && !readOnly && id !== "default"}
        <Selector label="Build on another agent" options={parentOptions} bind:value={addParent} action>
          {#snippet children()}<Icon name="plus" class="h-4 w-4" /><span>Add</span>{/snippet}
        </Selector>
      {/if}
    </div>
  </section>
  {#if id !== "default"}
    <section class="setting">
      <div class="setting-text">
        <h2 class="setting-title"><label for="home-view">App home view</label></h2>
        <p class="setting-sub">Open this view instead of a conversation, making the agent an app.{#if view.home && !definition?.home}{" "}Inherited: {view.home}.{/if}</p>
      </div>
      <form class="home" onsubmit={(event) => { event.preventDefault(); setHome(); }}>
        <Input id="home-view" label="Home view" placeholder="None" density="compact" maxlength={64} bind:value={home} disabled={readOnly} />
        {#if !readOnly}<button type="submit" class="ui-button" data-variant="secondary" data-size="compact" disabled={home.trim() === (definition?.home ?? "") || client.busy}>Save</button>{/if}
      </form>
    </section>
  {/if}
  <section class="setting">
    <div class="setting-text">
      <h2 class="setting-title">Stored in</h2>
      <p class="setting-sub mono">{readOnly ? `plugins/agents/${id}/agent.json, in PiSpark` : `agents/${id}/agent.json`}</p>
    </div>
  </section>
  {#if id !== "default" && !readOnly}
    <section class="setting">
      <div class="setting-text">
        <h2 class="setting-title">Delete this agent</h2>
        <p class="setting-sub">Sessions that used it keep their messages. Shared resources stay in the library.</p>
      </div>
      <button type="button" class="ui-button" data-variant="destructive" data-size="compact" onclick={() => (askingDelete = true)}>Delete agent</button>
    </section>
  {/if}
</div>

{#if askingDelete}
  <ConfirmDialog
    title={`Delete ${name}?`}
    text="Sessions that used it keep their messages. Shared resources stay in the library."
    action="Delete agent"
    busy={client.busy}
    onconfirm={() => void client.remove(id).then(() => (askingDelete = false))}
    oncancel={() => (askingDelete = false)}
  />
{/if}

<style>
  .settings {
    display: flex;
    flex-direction: column;
  }
  .setting {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 1.125rem 1.5rem;
  }
  .setting + .setting {
    border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  .setting-text {
    flex: 1;
    min-width: 0;
  }
  .setting-title {
    font-size: var(--text-md);
    font-weight: 500;
  }
  .setting-sub {
    font-size: var(--text-sm);
    color: var(--muted-foreground);
    overflow-wrap: anywhere;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 0.375rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 1.875rem;
    padding: 0 0.625rem;
    border-radius: var(--radius-full);
    background: var(--chip);
    font-size: var(--text-sm);
  }
  .chip-x {
    display: grid;
    place-items: center;
    color: var(--muted-foreground);
  }
  .home {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    width: 18rem;
  }
  @container agent (max-width: 47.5rem) {
    .setting {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 1rem 0;
    }
    .chips {
      justify-content: flex-start;
    }
    .home {
      width: 100%;
    }
  }
</style>
