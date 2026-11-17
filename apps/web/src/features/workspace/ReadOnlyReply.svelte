<script lang="ts">
  /**
   * In place of the reply box while a session is open for reading only (H-15): why it can't reply,
   * and the one way on. Its model's provider coming back (signed in again) reopens it by itself.
   */
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import { useSession, useSessions } from "./session-client.svelte";
  import { folderName } from "./session-presentation";

  const sessions = useSessions();
  const session = useSession()!;
  const doc = $derived(session.doc);
  const catalog = $derived(sessions.providers.catalog);
  const provider = $derived(catalog.providers.find((p) => p.id === doc?.model?.provider));
  const signedIn = $derived(!!provider?.configured);
  const usable = $derived(signedIn && !!provider?.models.some((m) => m.id === doc?.model?.id && m.available));
  const models = $derived(
    catalog.providers.flatMap((p) =>
      p.models.filter((m) => m.available).map((m) => ({ value: JSON.stringify({ provider: p.id, id: m.id }), label: `${m.name} · ${p.name}` })),
    ),
  );
  const reason = $derived(
    doc?.readOnly === "agent"
      ? `its agent “${doc.agent.name}” can’t be found`
      : doc?.readOnly === "folder"
        ? `its folder “${folderName(doc.folder)}” no longer exists on the server`
        : !doc?.model
          ? "it has no model"
          : !provider || !signedIn
            ? `you’re not signed in to ${provider?.name ?? doc.model.provider}`
            : `${provider.models.find((m) => m.id === doc.model!.id)?.name ?? doc.model.id} is no longer available`,
  );

  let choice = $state("");
  let trying = $state(false);
  async function reopen(model?: { provider: string; id: string }) {
    if (trying) return;
    trying = true;
    try {
      await session.reload(model);
    } finally {
      trying = false;
    }
  }
  $effect(() => {
    if (!choice) return;
    const model = JSON.parse(choice) as { provider: string; id: string };
    choice = "";
    void reopen(model);
  });
  // Signed in again (here or on Providers): the model can run, so open the session fully.
  void sessions.providers.refresh();
  let wasUsable: boolean | undefined;
  $effect(() => {
    const now = doc?.readOnly === "model" && usable;
    if (wasUsable === false && now) void reopen();
    wasUsable = now;
  });
</script>

<div class="read-only" role="group" aria-label="Can’t reply">
  <p class="why"><Icon name="info" class="h-4 w-4 shrink-0" /><span><strong>Can’t reply:</strong> {reason}.</span></p>
  <div class="ways">
    {#if doc?.readOnly === "model"}
      {#if provider && !signedIn}<a class="way" href="#/settings/providers">Sign in</a>{/if}
      <Selector label="Choose a model" action options={models} searchable bind:value={choice} emptyText="No model is signed in yet">
        {#snippet children()}<Icon name="model" class="h-3.5 w-3.5" /><span>Choose a model</span>{/snippet}
        {#snippet footer()}<a class="text-sm font-medium text-[var(--interactive-text)] hover:underline" href="#/settings/providers"
            >Providers &amp; models</a
          >{/snippet}
      </Selector>
    {:else if doc?.readOnly === "agent"}
      <a class="way" href="#/agents">Agents</a>
    {/if}
    <span class="flex-1"></span>
    <Button size="compact" variant="ghost" unavailable={trying ? "Trying…" : undefined} onclick={() => reopen()}>Try again</Button>
  </div>
</div>

<style>
  .read-only {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.625rem 0.5rem 0.5rem 0.875rem;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .why {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    line-height: 1.25rem;
  }
  .why strong {
    color: var(--foreground);
    font-weight: 600;
  }
  .ways {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-left: 1.5rem;
  }
  .way {
    font-weight: 600;
    color: var(--interactive-text);
  }
  .way:hover {
    text-decoration: underline;
  }
</style>
