<script lang="ts">
  import Icon from "../../lib/ui/Icon.svelte";
  import { reportBody, type Turn } from "./session-turns";
  import { useSession, useSessions } from "./session-client.svelte";
  import { namedFiles } from "./attachments.svelte";
  import StreamingMarkdown from "./StreamingMarkdown.svelte";
  /**
   * Your message, or (`woken`) one something else sent, labelled as such. One another session sent
   * (`from`: its report, or a parent's message to its child) is not yours, so it is not your bubble.
   */
  let { text, woken, from }: { text: string; woken?: string; from?: Turn["from"] } = $props();
  const client = useSessions();
  const session = useSession();
  // The label is "‹title› · finished": the title is what links to the session.
  const cut = $derived(from ? from.label.indexOf(" · ") : -1);
  const title = $derived(from ? (cut >= 0 ? from.label.slice(0, cut) : from.label) : "");
  const rest = $derived(from && cut >= 0 ? from.label.slice(cut) : "");
  const known = $derived(from?.kind === "session" && client.sessions.some((session) => session.id === from.id));
</script>

{#if from?.kind === "process"}
  <details class="process-report" data-purpose="session-turn">
    <summary class="woken">{from.label} <span class="disclosure"><span class="closed">▸ Show output</span><span class="opened">▾ Hide output</span></span></summary>
    <div class="report output">{reportBody(text)}</div>
  </details>
{:else if from}
  <div class="flex flex-col items-start gap-1.5" data-purpose="session-turn">
    <p class="woken">
      <Icon name="sessionBack" class="h-3.5 w-3.5" /><span
        >From {#if known}<button type="button" class="link" onclick={() => client.open(from.id)}>{title}</button>{:else}{title}{/if}{rest}</span
      >
    </p>
    <div class="report markdown"><StreamingMarkdown text={reportBody(text)} /></div>
  </div>
{:else}
  <div class="flex flex-col items-end gap-1.5" data-purpose="user-turn">
    {#if woken}<p class="woken"><Icon name="clock" class="h-3.5 w-3.5" /><span>{woken}</span></p>{/if}
    <div class="user-bubble">
      {#each namedFiles(text, session?.id) as piece}{#if typeof piece === "string"}{piece}{:else if piece.image && piece.url}<a
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
    white-space: pre-wrap;
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
  .report.markdown {
    white-space: normal;
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
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
    line-height: 1.55;
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
