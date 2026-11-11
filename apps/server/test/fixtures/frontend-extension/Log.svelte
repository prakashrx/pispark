<script lang="ts">
  // A chat frontend an extension owns: the chat as a plain log, with its own input. It is built
  // only from the `session` it is given, not from anything of PiSpark's own conversation.
  type Part = { type: string; text?: string; name?: string };
  type Item = { key: string; role: string; parts: Part[] };
  type Question = { id: string; title: string; kind: string };
  type Session = {
    doc?: { status: string; extensions: { dialogs: Question[] } };
    items: Item[];
    more: boolean;
    send(text: string): Promise<boolean>;
    stop(): Promise<void>;
    answer(id: string, value: string | boolean | null): Promise<void>;
    loadEarlier(): Promise<boolean>;
  };
  let { session }: { session: Session } = $props();
  let text = $state("");

  const status = $derived(session.doc?.status ?? "opening");
  const lines = $derived(
    session.items.flatMap((item) =>
      item.role === "user"
        ? [{ key: item.key, who: "you", text: item.parts.map((part) => part.text ?? "").join(" ") }]
        : item.role === "assistant"
          ? item.parts.flatMap((part, index) =>
              part.type === "text" && part.text?.trim()
                ? [{ key: `${item.key}.${index}`, who: "pi", text: part.text }]
                : part.type === "toolCall"
                  ? [{ key: `${item.key}.${index}`, who: "tool", text: part.name ?? "" }]
                  : [],
            )
          : [],
    ),
  );
  const questions = $derived(session.doc?.extensions.dialogs ?? []);

  async function send(event: SubmitEvent) {
    event.preventDefault();
    if (await session.send(text)) text = "";
  }
</script>

<section class="log" aria-label="Log frontend">
  <p role="status">state: {status}</p>
  {#if session.more}<button type="button" onclick={() => session.loadEarlier()}>earlier</button>{/if}
  <ol>
    {#each lines as line (line.key)}<li data-who={line.who}><b>{line.who}&gt;</b> {line.text}</li>{/each}
  </ol>
  {#each questions as question (question.id)}
    <div role="group" aria-label={question.title}>
      {question.title}
      {#if question.kind === "confirm"}
        <button type="button" onclick={() => session.answer(question.id, true)}>yes</button>
        <button type="button" onclick={() => session.answer(question.id, false)}>no</button>
      {:else}
        <button type="button" onclick={() => session.answer(question.id, null)}>skip</button>
      {/if}
    </div>
  {/each}
  <form onsubmit={send}>
    <input aria-label="Log input" bind:value={text} />
    <button disabled={status !== "idle"}>send</button>
    {#if status === "running"}<button type="button" onclick={() => session.stop()}>stop</button>{/if}
  </form>
</section>

<style>
  .log {
    flex: 1;
    padding: 1rem 1.5rem;
    font-family: ui-monospace, monospace;
    font-size: 0.875rem;
    color: var(--foreground);
    background: var(--muted);
  }
  ol {
    list-style: none;
    margin: 0.5rem 0;
    padding: 0;
  }
  li[data-who="you"] b {
    color: var(--interactive-text);
  }
  li[data-who="tool"] {
    color: var(--muted-foreground);
  }
  form {
    display: flex;
    gap: 0.5rem;
  }
  input {
    flex: 1;
    font: inherit;
    color: inherit;
    background: var(--background);
    border: 1px solid var(--border);
    padding: 0.25rem 0.5rem;
  }
</style>
