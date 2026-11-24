<script lang="ts">
  /**
   * The agent's AI: its Agent Builder session, beside the tabs (in their place on a phone). It
   * works on what's open in the tab, shown as "Working on", or on the whole agent. Each message
   * tells it, as a note it reads but you don't see, what's open and where its file is. What it
   * changes lands in the page, marked for Keep or Undo.
   */
  import { onMount } from "svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Menu from "../../lib/ui/Menu.svelte";
  import { go } from "../../routes";
  import type { Session } from "../workspace/session.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import BuilderConversation from "./BuilderConversation.svelte";
  import { afterReply, builderNote, itemKeys, unsavedReason } from "./agent-builder";
  import { isFresh, KINDS, type AgentPage, type Kind, type Row } from "./agent-page.svelte";

  let {
    page,
    name,
    tab,
    focus,
    narrow = false,
    onclose,
    onclear,
  }: {
    page: AgentPage;
    name: string;
    tab: string;
    /** What's open in the tab: Agent Builder works on it. */
    focus?: Row;
    narrow?: boolean;
    onclose: () => void;
    /** Work on the whole agent instead of what's open. */
    onclear: () => void;
  } = $props();

  const sessions = useSessions();
  let session = $state.raw<Session>();
  let error = $state("");
  let starting = $state(false);

  async function attach(fresh = false) {
    starting = true;
    error = "";
    try {
      const id = await page.client.builder(page.agent, fresh);
      await sessions.refresh();
      session?.hide();
      const next = sessions.session(id);
      next.note = () => builderNote(page, tabNow(), focusNow());
      next.hold = () => unsavedReason(page, focusNow());
      session = next;
      await next.show();
    } catch (failure) {
      error = (failure as Error).message;
    } finally {
      starting = false;
    }
  }
  // The latest of what's open, for the note (props read inside a closure stay current).
  const focusNow = () => focus;
  const tabNow = () => tab;

  onMount(() => {
    void attach();
    return () => session?.hide();
  });

  // A reply ended: the page reads the agent again and opens anything new it made.
  let before: Set<string> | undefined;
  $effect(() => {
    const status = session?.doc?.status;
    const working = status === "running" || status === "queued" || status === "cancelling";
    if (working && !before) before = itemKeys(page);
    else if (!working && before) {
      void afterReply(page, before);
      before = undefined;
    }
  });

  const hasHistory = $derived(!!session?.doc?.hasHistory || !!session?.items.length);
  const busy = $derived(["running", "queued", "cancelling"].includes(session?.doc?.status ?? ""));
  const focusLabel = $derived.by(() => {
    if (!focus) return "";
    const one = KINDS[focus.type as Kind]?.one ?? focus.type;
    if (isFresh(focus)) return focus.name ? `New ${one} · ${focus.name}` : `New ${one}`;
    return `${one[0]!.toUpperCase()}${one.slice(1)} · ${focus.type === "prompts" ? "/" : ""}${focus.name}`;
  });
  const suggestions = $derived(
    !focus
      ? tab in KINDS
        ? [`What ${KINDS[tab as Kind].one} would help this agent?`, "Review this agent and suggest improvements"]
        : ["Review this agent and suggest improvements"]
      : isFresh(focus)
        ? [`Help me write this ${KINDS[focus.type as Kind]?.one ?? "item"}`]
        : ["Make it shorter", "Add an example", "Review it for gaps"],
  );
  const send = (text: string) => void session?.send(text);

  async function openAsSession() {
    if (!session) return;
    const id = session.id;
    try {
      await page.client.release(id);
      await sessions.refresh();
      session.hide();
      session = undefined;
      go({ name: "session", id });
    } catch (failure) {
      error = (failure as Error).message;
    }
  }
</script>

<section class="builder" data-narrow={narrow || undefined} aria-label="Agent Builder">
  <header class="head">
    <span class="mark" aria-hidden="true"><Icon name="pencil" class="h-4 w-4" /></span>
    <div class="title">
      <h2>Agent Builder</h2>
      <p>Its session for {name}. It isn't listed with your sessions.</p>
    </div>
    <button type="button" class="ui-button" data-size="icon" aria-label="New conversation" title="New conversation" disabled={!session || !hasHistory || busy || starting} onclick={() => void attach(true)}><Icon name="plus" class="h-4 w-4" /></button>
    <Menu
      label="Agent Builder options"
      items={[
        { id: "open", label: "Open as a session", disabled: !session, onselect: () => void openAsSession() },
        { id: "about", label: "About Agent Builder", onselect: () => go({ name: "agents", id: "agent-builder" }) },
      ]}
    />
    {#if !narrow}<button type="button" class="ui-button" data-size="icon" aria-label="Close Agent Builder" title="Close" onclick={onclose}><Icon name="close" class="h-4 w-4" /></button>{/if}
  </header>

  <div class="focus">
    {#if focus}
      <span class="focus-label">Working on</span>
      <span class="focus-chip">{focusLabel}<button type="button" class="focus-x" aria-label="Work on the whole agent instead" title="Work on the whole agent" onclick={onclear}><Icon name="close" class="h-3 w-3" /></button></span>
    {:else}
      <span class="focus-label">Working on the whole agent{tab in KINDS ? `. Anything new goes in ${KINDS[tab as Kind].title}.` : "."}</span>
    {/if}
  </div>

  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if session}
    {#key session.id}
      {#if !hasHistory && !busy}
        <div class="suggest">
          {#each suggestions as s (s)}<button type="button" class="chip" onclick={() => send(s)}>{s}</button>{/each}
        </div>
      {/if}
      <BuilderConversation {session} held={unsavedReason(page, focus)} />
    {/key}
  {:else if starting}
    <p class="status" role="status">Starting Agent Builder…</p>
  {/if}
</section>

<style>
  .builder {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: color-mix(in srgb, var(--muted) 35%, var(--background));
  }
  .builder[data-narrow] {
    background: transparent;
    min-height: 32rem;
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.875rem 0.75rem 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .mark {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent-fill) 14%, transparent);
    color: var(--accent-text);
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  h2 {
    font-size: var(--text-md);
    font-weight: 600;
  }
  .title p {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .focus {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem 0.5rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--border);
    font-size: var(--text-xs);
  }
  .focus-label {
    color: var(--muted-foreground);
  }
  .focus-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.25rem 0.125rem 0.5rem;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--accent-fill) 12%, transparent);
    color: var(--accent-text);
    font-weight: 500;
  }
  .focus-x {
    display: grid;
    place-items: center;
    width: 1.125rem;
    height: 1.125rem;
    border-radius: 50%;
  }
  .focus-x:hover {
    background: color-mix(in srgb, var(--accent-fill) 18%, transparent);
  }
  .suggest {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0.75rem 0.75rem 0;
  }
  .chip {
    padding: 0.3125rem 0.625rem;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--background);
    font-size: var(--text-sm);
    text-align: left;
  }
  .chip:hover {
    border-color: var(--foreground);
  }
  .status,
  .error {
    padding: 0.75rem 1rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .error {
    color: var(--danger-foreground);
  }
</style>
