<script lang="ts">
  /**
   * One of a session's files, opened beside the conversation (design set 4/2, D-10): a picture is
   * shown, a PDF in the browser's own viewer, Markdown rendered, other text as it is; anything else
   * can be downloaded. Read-only: the file as it is now.
   */
  import Icon from "../../lib/ui/Icon.svelte";
  import { Markdown } from "../../lib/markdown";
  import { fileKind, fileUrl, sessionImageUrl } from "./file-kinds";

  let { sessionId, name }: { sessionId: string; name: string } = $props();
  const url = $derived(fileUrl(sessionId, name));
  const kind = $derived(fileKind(name));
  const TEXT_LIMIT = 1024 * 1024;
  let text = $state<string>();
  let error = $state("");
  $effect(() => {
    text = undefined;
    error = "";
    if (kind !== "markdown" && kind !== "text") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? "This file is no longer there." : "This file couldn’t be read.");
        const body = await response.text();
        text = body.length > TEXT_LIMIT ? `${body.slice(0, TEXT_LIMIT)}\n…` : body;
      } catch (failure) {
        if (!controller.signal.aborted) error = (failure as Error).message;
      }
    })();
    return () => controller.abort();
  });
</script>

<div class="file">
  <div class="bar">
    <span class="name">{name}</span>
    <a class="download" href={url} download={name} title="Download"><Icon name="file" class="h-4 w-4" /><span>Download</span></a>
  </div>
  {#if kind === "image"}<img src={url} alt={name} class="picture" />
  {:else if kind === "pdf"}<iframe src={url} title={name} class="pdf"></iframe>
    <p class="note">If the PDF doesn’t show here, <a href={url} target="_blank" rel="noopener noreferrer">open it in a new tab</a>.</p>
  {:else if kind === "markdown" || kind === "text"}
    {#if error}<p role="alert" class="note danger">{error}</p>
    {:else if text === undefined}<p class="note">Reading…</p>
    {:else if kind === "markdown"}{#key name}<Markdown {text} options={{ images: (href) => sessionImageUrl(sessionId, href) }} />{/key}
    {:else}<!-- svelte-ignore a11y_no_noninteractive_tabindex --><pre class="text" tabindex="0" aria-label={`Contents of ${name}`}>{text}</pre>{/if}
  {:else}<p class="note">No preview for this kind of file. Download it to open it.</p>{/if}
</div>

<style>
  .file {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--text-sm);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .download {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    color: var(--interactive-text);
  }
  .download:hover {
    background: var(--accent);
  }
  .picture {
    max-width: 100%;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
  }
  .pdf {
    width: 100%;
    height: 70dvh;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .text {
    max-height: 70dvh;
    overflow: auto;
    padding: 0.75rem 0.875rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--code-surface, var(--muted));
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .note {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .note a {
    color: var(--interactive-text);
    text-decoration: underline;
  }
  .danger {
    color: var(--danger-foreground);
  }
</style>
