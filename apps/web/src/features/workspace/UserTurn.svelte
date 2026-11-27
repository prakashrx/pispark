<script lang="ts">
  import Icon from "../../lib/ui/Icon.svelte";
  import type { From, Turn } from "./session-turns";
  import type { Item } from "../../../../server/src/contract/protocol";
  import { useSession, useSessions } from "./session-client.svelte";
  import { namedFiles } from "./attachments.svelte";
  import SessionMarkdown from "./SessionMarkdown.svelte";
  /**
   * Your message, or (`woken`) one something else sent, labelled as such. One another session sent
   * (`from`: its report, or a parent's message to its child) is not yours, so it is not your bubble.
   * Several that arrived as one message (`together`) are shown one under the other.
   */
  let { text, woken, from, together, item }: { text: string; woken?: string; from?: Turn["from"]; together?: Turn["together"]; item?: Item } = $props();
  const client = useSessions();
  const session = useSession();
  const known = (from: From) => from.kind === "session" && client.sessions.some((session) => session.id === from.id);
  // Your own saved message can be edited and sent again, between replies; its versions switch then too.
  const free = $derived(!!session && !session.doc?.readOnly && (session.doc?.status === "idle" || session.doc?.status === "error"));
  const editable = $derived(!woken && !!item?.id && free);
  const editing = $derived(!!item?.id && session?.editing?.entryId === item.id);
  const versions = $derived(item?.versions);
</script>

<!-- What a session or a process sent: whose it is and how it ended ("‹title› · finished", the title linking to
     the session), then the report itself, after the line the agent needs, which the heading says already. -->
{#snippet sent(from: From, body: string)}
  {#if from.kind === "process" || from.kind === "reload"}
    {@const what = from.kind === "process" ? "output" : "details"}
    <details class="process-report" data-purpose="session-turn">
      <summary class="woken">{from.label} <span class="disclosure"><span class="closed">▸ Show {what}</span><span class="opened">▾ Hide {what}</span></span></summary>
      <div class="report output">{body}</div>
    </details>
  {:else if from.folded}
    <!-- Its row above holds the answer: here, only that it reached this session. -->
    <p class="woken" data-purpose="delivery">
      <Icon name="sessionBack" class="h-3.5 w-3.5" /><span
        >Answer from {#if known(from)}<button type="button" class="link" onclick={() => client.open(from.id)}>{from.title}</button>{:else}{from.title}{/if}{` reached this session${
            from.how && from.how !== "finished" ? ` · ${from.how}` : ""
          }`}</span
      >
    </p>
  {:else}
    <div class="flex flex-col items-start gap-1.5" data-purpose="session-turn">
      <p class="woken">
        <Icon name="sessionBack" class="h-3.5 w-3.5" /><span
          >From {#if known(from)}<button type="button" class="link" onclick={() => client.open(from.id)}>{from.title}</button>{:else}{from.title}{/if}{from.how
            ? ` · ${from.how}`
            : ""}</span
        >
      </p>
      <div class="report markdown"><SessionMarkdown text={body} /></div>
    </div>
  {/if}
{/snippet}

{#if together}
  <div class="flex w-full flex-col items-start gap-3" data-purpose="together">
    {#each together as part, index (index)}{@render sent(part, text.slice(part.at + part.start, together[index + 1]?.at).trimEnd())}{/each}
  </div>
{:else if from}
  {@render sent(from, text.slice(from.start))}
{:else}
  <div class="flex flex-col items-end gap-1.5" data-purpose="user-turn">
    {#if woken}<p class="woken"><Icon name="clock" class="h-3.5 w-3.5" /><span>{woken}</span></p>{/if}
    <div class="bubble-row">
      {#if editable}<button type="button" class="edit" class:editing aria-label="Edit message" title="Edit message" aria-pressed={editing}
          onclick={() => (editing ? session.cancelEdit() : session.edit(item!.id!, text))}><Icon name="pencil" class="h-3.5 w-3.5" /></button
        >{/if}
      <div class="user-bubble">
      {#each namedFiles(text, session?.id) as piece}{#if typeof piece === "string"}<SessionMarkdown text={piece} flavor="typed" />{:else if piece.image && piece.url}<a
            class="named-image"
            href={piece.url}
            target="_blank"
            rel="noopener"
            title={piece.name}><img src={piece.url} alt={piece.name} loading="lazy" /></a
          >{:else if piece.url}<a class="named-file" href={piece.url} target="_blank" rel="noopener" title={piece.name}
            ><Icon name="file" class="h-3.5 w-3.5" /><span>{piece.name}</span></a
          >{:else}<span class="named-file" title={piece.name}><Icon name="file" class="h-3.5 w-3.5" /><span>{piece.name}</span></span
          >{/if}{/each}
      </div>
    </div>
    {#if versions}<div class="user-actions">
        {#if versions}<span class="versions">
            <button type="button" aria-label="Previous version" title="Previous version" disabled={!versions.previous || !free}
              onclick={() => versions.previous && void session.branch(versions.previous)}><Icon name="chevronRight" class="h-3.5 w-3.5 flip" /></button
            ><span class="sr-only">Version {versions.at} of {versions.of}</span><span aria-hidden="true">{versions.at} / {versions.of}</span><button
              type="button" aria-label="Next version" title="Next version" disabled={!versions.next || !free}
              onclick={() => versions.next && void session.branch(versions.next)}><Icon name="chevronRight" class="h-3.5 w-3.5" /></button
            ></span>{/if}
      </div>{/if}
  </div>
{/if}

<style>
  .user-bubble,
  .report {
    max-width: min(36rem, 80%);
    padding: 0.625rem 1.125rem;
    border-radius: var(--radius-xl);
    font-family: var(--font-reading);
    font-size: 1rem;
    line-height: 1.6;
    overflow-wrap: anywhere;
    color: var(--foreground);
  }
  .user-bubble {
    background: var(--bubble);
  }
  /* A file the message named, in its place: a chip, or a thumbnail for an image. */
  .named-file {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    max-width: 15rem;
    margin: 0 0.125rem;
    padding: 0.05rem 0.4rem;
    vertical-align: middle;
    border: 1px solid var(--border);
    border-radius: 0.4375rem;
    background: var(--surface-raised);
    font-family: var(--font-sans);
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--foreground);
    text-decoration: none;
  }
  .named-file span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  a.named-file:hover {
    border-color: color-mix(in srgb, var(--interactive) 45%, var(--border));
  }
  .named-image {
    display: inline-block;
    margin: 0.125rem;
    padding: 0.125rem;
    vertical-align: middle;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-raised);
  }
  .named-image img {
    display: block;
    height: 3.25rem;
    max-width: 6rem;
    border-radius: 0.375rem;
    object-fit: cover;
  }
  .named-image:hover,
  .named-image:focus-visible {
    border-color: var(--interactive);
  }
  /* Another session's words (design set 3/2): indented under its line, a rule beside them, no bubble. */
  .report {
    max-width: 100%;
    margin-left: 0.4rem;
    padding: 0 0 0 0.75rem;
    border-left: 2px solid var(--border);
    border-radius: 0;
  }
  .process-report > summary {
    display: block;
    list-style: none;
    cursor: pointer;
    padding-block: 0.5rem;
  }
  .process-report summary::-webkit-details-marker { display: none; }
  .disclosure { white-space: nowrap; }
  .opened, .process-report[open] .closed { display: none; }
  .process-report[open] .opened { display: inline; }
  .report.output {
    white-space: pre-wrap;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
    line-height: 1.55;
  }
  /* Edit sits by your message's top-left corner: on hover or focus where there is a pointer, always on touch. */
  .bubble-row {
    display: flex;
    justify-content: flex-end;
    align-items: flex-start;
    gap: 0.375rem;
    width: 100%;
  }
  .edit {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    margin-top: 0.375rem;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
  }
  .edit:hover,
  .edit:focus-visible,
  .edit.editing {
    background: var(--accent);
    color: var(--foreground);
  }
  /* Under your message: its versions. */
  .user-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-top: -0.125rem;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .user-actions button {
    display: inline-grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
  }
  .user-actions button:not(:disabled):hover,
  .user-actions button:focus-visible {
    background: var(--accent);
    color: var(--foreground);
  }
  .user-actions button:disabled {
    opacity: 0.35;
  }
  .versions {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    font-variant-numeric: tabular-nums;
  }
  .versions :global(.flip) {
    transform: rotate(180deg);
  }
  @media (hover: hover) {
    .edit {
      opacity: 0;
    }
    [data-purpose="user-turn"]:hover .edit,
    .edit:focus-visible,
    .edit.editing {
      opacity: 1;
    }
  }
  .woken {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .link {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
