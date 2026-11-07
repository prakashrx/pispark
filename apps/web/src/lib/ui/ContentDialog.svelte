<script module lang="ts">
  export type ContentSnapshot = {
    stage: "add" | "read" | "edit" | "customize";
    readText: string;
    editor: string;
    readScroll: number;
    scroll: number;
  };
</script>

<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import InlinePanel from "./InlinePanel.svelte";
  import Button from "./Button.svelte";
  import Textarea from "./Textarea.svelte";
  import FormField from "./FormField.svelte";
  import { importText, textError } from "./text-import";

  let {
    ownerKey,
    value,
    mode = "read",
    permission = "none",
    active = true,
    canApply = true,
    maxBytes,
    title = "Content",
    addTitle = "Add content",
    editTitle = "Edit content",
    customizeTitle = "Customize content",
    label = "Text",
    addLabel = "Add content",
    applyLabel = "Apply changes",
    applyError,
    onapply,
    onclose,
    retained,
    onstate,
  }: {
    // Change for every owner/target identity; value is the opening read baseline.
    ownerKey: string;
    value: string;
    mode?: "add" | "read" | "edit" | "customize";
    permission?: "none" | "edit" | "customize";
    // Keep mounted with active=false to pause without losing private edits.
    active?: boolean;
    canApply?: boolean;
    maxBytes: number;
    title?: string;
    addTitle?: string;
    editTitle?: string;
    customizeTitle?: string;
    label?: string;
    addLabel?: string;
    applyLabel?: string;
    applyError?: string;
    // Synchronous feature guard: recheck identity, writability, target and capacity.
    // false keeps the private editor open; true accepts a draft, never a durable save.
    onapply: (text: string) => boolean;
    onclose: () => void;
    // One optional feature-owned UI snapshot; imports and temporary consent are never retained.
    retained?: ContentSnapshot;
    onstate?: (state: ContentSnapshot) => void;
  } = $props();

  const id = $props.id();
  let stage = $state(untrack(() => mode));
  let readText = $state(untrack(() => value));
  let editor = $state(untrack(() => value));
  let error = $state<string>();
  let importing = $state(false);
  let replacement = $state<{ text: string; current: () => boolean }>();
  let discarding = $state(false);
  let hovering = $state(false);
  let viewport = $state<HTMLDivElement>(undefined!);
  let heading = $state<HTMLDivElement>(undefined!);
  let picker = $state<HTMLInputElement>(undefined!);
  let readScroll = $state(0);
  let pausedScroll = $state(0);
  let importEpoch = 0;
  let alive = true;
  let context:
    | { ownerKey: string; value: string; mode: typeof mode }
    | undefined;
  let access:
    | {
        active: boolean;
        permission: typeof permission;
        canApply: boolean;
        maxBytes: number;
      }
    | undefined;
  const editing = $derived(stage !== "read");
  const writable = $derived(stage === "add" || permission !== "none");
  const invalid = $derived(textError(editor, maxBytes));
  const message = $derived(
    error ?? applyError ?? (editor.length ? invalid : undefined),
  );
  const dialogTitle = $derived(
    stage === "add"
      ? addTitle
      : stage === "edit"
        ? editTitle
        : stage === "customize"
          ? customizeTitle
          : title,
  );

  function revokeImport() {
    importEpoch++;
    importing = false;
    replacement = undefined;
    hovering = false;
  }
  $effect(() => {
    // Prop changes represent a new read context, not a keystroke binding.
    const initial = { ownerKey, value, mode };
    if (
      context &&
      context.ownerKey === initial.ownerKey &&
      context.value === initial.value &&
      context.mode === initial.mode
    )
      return;
    context = initial;
    revokeImport();
    const snapshot = untrack(() => retained);
    stage = snapshot?.stage ?? initial.mode;
    readText = snapshot?.readText ?? initial.value;
    editor = snapshot?.editor ?? initial.value;
    error = undefined;
    discarding = false;
    readScroll = snapshot?.readScroll ?? 0;
    pausedScroll = snapshot?.scroll ?? 0;
  });
  $effect(() => {
    const next = { active, permission, canApply, maxBytes };
    if (
      access &&
      access.active === next.active &&
      access.permission === next.permission &&
      access.canApply === next.canApply &&
      access.maxBytes === next.maxBytes
    )
      return;
    const resumed = !access?.active && next.active;
    access = next;
    revokeImport();
    if (resumed) void restore(pausedScroll);
  });
  $effect(() => {
    onstate?.({ stage, readText, editor, readScroll, scroll: pausedScroll });
  });
  onDestroy(() => {
    alive = false;
    revokeImport();
  });

  async function restore(scroll: number) {
    await tick();
    if (!alive || !active || !viewport) return;
    const textarea = viewport.querySelector("textarea");
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.max(viewport.clientHeight - 32, textarea.scrollHeight)}px`;
      textarea.focus({ preventScroll: true });
    } else heading?.focus({ preventScroll: true });
    viewport.scrollTop = scroll;
  }
  function beginEdit() {
    if (permission === "none") return;
    readScroll = viewport.scrollTop;
    editor = readText;
    stage = permission;
    error = undefined;
    void restore(readScroll);
  }
  function changed() {
    revokeImport();
    error = undefined;
    discarding = false;
    const scroll = viewport.scrollTop;
    void restore(scroll);
  }
  function cancelEdit() {
    revokeImport();
    if (stage === "add") return onclose();
    editor = readText;
    stage = "read";
    discarding = false;
    error = undefined;
    void restore(readScroll);
  }
  function requestClose() {
    revokeImport();
    if (editing && editor !== readText) discarding = true;
    else onclose();
  }
  function apply() {
    if (
      !active ||
      !writable ||
      !canApply ||
      importing ||
      replacement !== undefined ||
      discarding
    )
      return;
    error = invalid;
    if (error) return;
    revokeImport();
    if (!onapply(editor)) return;
    if (stage === "add") return onclose();
    const scroll = viewport.scrollTop;
    readText = editor;
    stage = "read";
    readScroll = scroll;
    void restore(scroll);
  }
  async function files(files: File[]) {
    revokeImport();
    if (!files.length) return;
    if (!active || !editing || !writable || !canApply) return;
    if (files.length !== 1) {
      error = "Choose one text file at a time.";
      return;
    }
    const epoch = importEpoch;
    const context = { ownerKey, value, mode, permission, maxBytes };
    const current = () =>
      alive &&
      epoch === importEpoch &&
      active &&
      editing &&
      writable &&
      canApply &&
      ownerKey === context.ownerKey &&
      value === context.value &&
      mode === context.mode &&
      permission === context.permission &&
      maxBytes === context.maxBytes;
    importing = true;
    error = undefined;
    try {
      const text = await importText(files[0]!, maxBytes);
      if (!current()) return;
      if (editor.length) replacement = { text, current };
      else {
        editor = text;
        void restore(0);
      }
    } catch (cause) {
      if (current())
        error =
          cause instanceof Error
            ? cause.message
            : "Unable to read this text file. Try again.";
    } finally {
      if (current()) importing = false;
    }
  }
  function replaceText() {
    if (
      replacement === undefined ||
      !replacement.current() ||
      !active ||
      !editing ||
      !writable ||
      !canApply
    )
      return;
    editor = replacement.text;
    revokeImport();
    void restore(0);
  }
</script>

{#if active}
  <InlinePanel
    label={dialogTitle}
    title={dialogTitle}
    size="wide"
    onclose={requestClose}
    initialFocus={editing ? `#${id}-editor` : `#${id}-read`}
  >
    <div
      class="content-viewport"
      bind:this={viewport}
      onscroll={() => (pausedScroll = viewport.scrollTop)}
    >
      {#if editing}
        <FormField id={`${id}-editor`} {label}>
          {#snippet children()}
            <div
              class:dragging={hovering}
              class="editor-surface"
              role="group"
              aria-label="Text editor"
              ondragover={(event) => {
                event.preventDefault();
                if (writable && canApply) hovering = true;
              }}
              ondragleave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node))
                  hovering = false;
              }}
              ondrop={(event) => {
                event.preventDefault();
                void files(Array.from(event.dataTransfer?.files ?? []));
              }}
            >
              <Textarea
                id={`${id}-editor`}
                {label}
                aria-describedby={message ? `${id}-error` : undefined}
                invalid={!!message}
                readonly={!writable}
                bind:value={editor}
                oninput={changed}
                rows={10}
              />
              {#if hovering}<span class="drag-hint"
                  >Drop one text file to import</span
                >{/if}
            </div>
          {/snippet}
        </FormField>
      {:else}
        <div
          id={`${id}-read`}
          bind:this={heading}
          tabindex="-1"
          class="read-text"
          role="document"
          aria-label={label}
        >
          {readText}
        </div>
      {/if}
    </div>
    {#if editing && message}<p
        id={`${id}-error`}
        role="alert"
        class="text-sm text-[var(--danger-foreground)]"
      >
        {message}
      </p>{/if}
    {#if importing}<p role="status" class="text-sm text-muted-foreground">
        Reading text…
      </p>{/if}
    {#if replacement !== undefined}
      <div role="alert" class="space-y-2">
        <p class="text-sm">
          Replace the current editor text with the imported text?
        </p>
        <Button onclick={replaceText}>Replace text</Button>
        <Button
          onclick={() => {
            revokeImport();
            void restore(pausedScroll);
          }}>Keep current text</Button
        >
      </div>
    {/if}
    {#if discarding}
      <div role="alert" class="space-y-2">
        <p class="text-sm">Discard unapplied changes and close?</p>
        <Button
          variant="destructive"
          onclick={() => {
            revokeImport();
            onclose();
          }}>Discard changes</Button
        >
        <Button
          onclick={() => {
            discarding = false;
            void restore(pausedScroll);
          }}>Keep editing</Button
        >
      </div>
    {/if}
    {#snippet footer()}
      {#if editing}
        <input
          bind:this={picker}
          type="file"
          hidden
          accept="text/*,.txt,.md"
          onchange={() => {
            const selected = Array.from(picker.files ?? []);
            picker.value = "";
            void files(selected);
          }}
          oncancel={() => {
            revokeImport();
          }}
        />
        <Button
          variant="ghost"
          disabled={!writable || !canApply || importing || discarding}
          onclick={() => picker.click()}>Import text</Button
        >
        <Button onclick={cancelEdit}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!writable ||
            !canApply ||
            !!invalid ||
            importing ||
            replacement !== undefined ||
            discarding}
          onclick={apply}>{stage === "add" ? addLabel : applyLabel}</Button
        >
      {:else}
        {#if permission !== "none"}<Button onclick={beginEdit}
            >{permission === "edit" ? "Edit" : "Customize"}</Button
          >{/if}
        <Button onclick={requestClose}>Close</Button>
      {/if}
    {/snippet}
  </InlinePanel>
{/if}

<style>
  .content-viewport {
    max-height: min(55dvh, 32rem);
    overflow: auto;
    overflow-wrap: anywhere;
  }
  .read-text {
    white-space: pre-wrap;
    font-size: 0.875rem;
    line-height: 1.6;
    padding: 0.5rem;
  }
  .editor-surface {
    position: relative;
  }
  .editor-surface :global(textarea) {
    resize: none;
    overflow: hidden;
    min-height: 12rem;
  }
  .dragging {
    outline: 2px dashed var(--subtle-foreground);
    outline-offset: -2px;
  }
  .drag-hint {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: var(--surface-raised);
    padding: 0.5rem;
    font-size: 0.75rem;
    pointer-events: none;
  }
</style>
