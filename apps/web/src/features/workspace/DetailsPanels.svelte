<script lang="ts">
  /**
   * A session's Details (design language §1.5a): a stack of foldable panels. "Started here" comes
   * first: everything the conversation started that is still open, of any kind, in one list. Then
   * Session (agent, model and thinking, which apply from the next reply, folder, when and by whom it
   * started), its context, its artifacts, the panels its extensions add (`session.details`), its
   * forks and its agent's routines. The longer work (a schedule's form, a process's output, editing
   * the agent) opens as a view in the same panel, with Back to here.
   */
  import Button from "../../lib/ui/Button.svelte";
  import Fold from "../../lib/ui/Fold.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import type { ThinkingLevel } from "../../../../server/src/contract/agent-protocol";
  import { contributionsFor } from "./extension-views";
  import type { SessionFile, SessionInfo } from "../../../../server/src/contract/protocol";
  import { fileKind, fileSize, fileUrl } from "../files/file-kinds";
  import Icon from "../../lib/ui/Icon.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import StartedHere from "../started/StartedHere.svelte";
  import { sourcesOf, startedBy } from "../started/work";
  import StatusMark from "../../lib/ui/StatusMark.svelte";
  import { describeSchedule } from "../../../../server/src/contract/cron";
  import type { Routine } from "../../../../server/src/contract/schedule-protocol";
  import { layout } from "../../shell/layout.svelte";
  import ScheduleDialog from "../schedules/ScheduleDialog.svelte";
  import type { ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
  import ContributionPoint from "./ContributionPoint.svelte";
  import { details } from "./details.svelte";
  import { useSession, useSessions } from "./session-client.svelte";
  import { contextText, modelName, sessionName, sessionStarted, sessionState, sessionStatus, THINKING_WORDS } from "./session-presentation";

  const client = useSessions();
  const session = useSession();
  const info = $derived(session.info);
  const model = $derived(modelName(client.providers.catalog.providers, session.doc?.model));
  const parent = $derived(info?.parent ? client.sessions.find((each) => each.id === info.parent) : undefined);
  // How many things it started are still open: beside the heading, and whether the list is worth unfolding.
  const openCount = $derived(info ? startedBy(info, sourcesOf(client), Date.now()).filter((work) => work.open).length : 0);
  const forks = $derived(info ? client.sessions.filter((each) => each.parent === info.id && each.forkOf) : []);
  const routines = $derived(info ? client.routines.of(info.agent.id) : []);
  const doc = $derived(session.doc);
  // Compacting needs the session free; model and thinking can be chosen any time and apply from the
  // next reply (chosen while it works, they wait for the reply to finish).
  const between = $derived((doc?.status === "idle" || doc?.status === "error") && !doc.readOnly && !doc.compacting);
  const changeable = $derived(!!doc && !doc.readOnly && !doc.compacting && doc.status !== "starting" && doc.status !== "stopping");
  const models = $derived(
    client.providers.catalog.providers.flatMap((p) =>
      p.models.filter((m) => m.available).map((m) => ({ value: JSON.stringify({ provider: p.id, id: m.id }), label: `${m.name} · ${p.name}` })),
    ),
  );
  const shownModel = $derived(doc?.pending?.model ?? doc?.model);
  const modelValue = $derived(shownModel ? JSON.stringify({ provider: shownModel.provider, id: shownModel.id }) : "");
  const thinkingValue = $derived(doc?.pending?.thinking ?? doc?.thinking?.level);
  const levels = $derived((doc?.thinking?.levels ?? []).map((level) => ({ value: level, label: THINKING_WORDS[level] ?? level })));
  let configureError = $state("");
  async function configure(change: { model?: { provider: string; id: string }; thinking?: ThinkingLevel }) {
    configureError = "";
    try {
      await session.configure(change);
    } catch (failure) {
      configureError = (failure as Error).message;
    }
  }
  let compactResult = $state("");
  let requestingCompaction = $state(false);
  async function compactContext() {
    compactResult = "";
    requestingCompaction = true;
    try {
      await session.compact();
      compactResult = "Context compacted.";
    } catch (failure) {
      compactResult = (failure as Error).message;
    } finally {
      requestingCompaction = false;
    }
  }
  // Artifacts (design set 4/2): the files you attached and the ones the agent made for you, read
  // again when the session has said or done something new.
  let files = $state<SessionFile[]>([]);
  const changes = $derived(`${session.items.length}:${doc?.status}`);
  $effect(() => {
    void changes;
    let stale = false;
    void session
      .files()
      .then((list) => {
        if (!stale) files = list;
      })
      .catch(() => {});
    return () => (stale = true);
  });
  // Panels the session's extensions add, each under its own title, built like PiSpark's own.
  const panels = $derived(contributionsFor(doc?.extensions, "session.details"));
  let routineError = $state("");
  /** The schedule open in its dialog; `true` for a new one. */
  let editing = $state<ScheduleSummary | true>();

  async function switchRoutine(routine: Routine, on: boolean) {
    routineError = "";
    try {
      await client.routines.set(routine, on);
      await client.refresh().catch(() => {});
    } catch (failure) {
      routineError = (failure as Error).message;
    }
  }
</script>

{#if info}
  <div class="panels">
    <Fold title="Started here" count={openCount ? String(openCount) : undefined}>
      {#snippet action()}<button
          type="button"
          class="icon"
          aria-label="Add a schedule"
          title="Add a schedule"
          onclick={() => (editing = true)}><Icon name="plus" class="h-4 w-4" /></button
        >{/snippet}
      <StartedHere owner={info} onschedule={(schedule) => (editing = schedule)} />
    </Fold>

    <Fold title="Session">
      <dl class="facts">
        <div>
          <dt>Agent</dt>
          <dd>{info.agent.name}{#if info.agent.layered}<span class="muted"> · edited for this session</span>{/if}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd data-model-picker>
            {#if doc && !doc.readOnly && models.length}<Selector
                label="Model"
                options={models}
                searchable
                disabled={!changeable}
                bind:value={() => modelValue, (value) => void (value && value !== modelValue && configure({ model: JSON.parse(value) }))}
              />{:else}{model ?? "Not available"}{/if}
          </dd>
        </div>
        {#if doc?.thinking && levels.length > 1}<div>
            <dt>Thinking</dt>
            <dd>
              <Selector
                label="Thinking"
                options={levels}
                disabled={!changeable}
                bind:value={() => thinkingValue, (value) => void (value && value !== thinkingValue && configure({ thinking: value as ThinkingLevel }))}
              />
            </dd>
          </div>{/if}
        <div>
          <dt>Folder</dt>
          <dd class="path">{info.folder}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{sessionStarted(info)}</dd>
        </div>
        {#if parent}<div>
            <dt>{info?.forkOf ? "Forked from" : "Started by"}</dt>
            <dd><button type="button" class="link" onclick={() => client.open(parent.id)}>{sessionName(parent)}</button></dd>
          </div>{/if}
      </dl>
      {#if doc?.pending?.model || doc?.pending?.thinking}<p class="note" role="status">Applies when this reply finishes.</p>{/if}
      {#if configureError}<p role="alert" class="note danger">{configureError}</p>{/if}
      <!-- An extension's title chips sit beside the name on wide screens, and here otherwise. -->
      {#if layout.size !== "expanded" && session.doc}<div class="chips"><ContributionPoint point="session.title" /></div>{/if}
    </Fold>

    {#if doc?.context}{@const context = doc.context}<Fold title="Context" count={contextText(context)}>
        {#if context.percent !== null}<div
            class="meter"
            role="meter"
            aria-label="Context used"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(context.percent)}
          >
            <span style:width={`${Math.min(100, context.percent)}%`}></span>
          </div>{/if}
        <p class="note">
          {context.percent === null ? "Measured again after the next reply. " : ""}Earlier messages are summarized when it fills up, before your next message where it can.
        </p>
        <Button size="compact" variant="ghost"
          unavailable={!between || requestingCompaction ? "The session is busy" : undefined}
          onclick={compactContext}>{requestingCompaction || doc.compacting ? "Compacting…" : "Compact context"}</Button>
        {#if doc.compacting}<Button size="compact" variant="ghost" onclick={() => void session.stop()}>Cancel compaction</Button>{/if}
        {#if compactResult}<p role="status">{compactResult}</p>{/if}
      </Fold>{/if}

    {#if files.length}<Fold title="Artifacts" count={String(files.length)}>
        <ul class="tiles" aria-label="Artifacts">
          {#each files as file (file.name)}<li>
              <button
                type="button"
                class="tile"
                aria-label={`${file.name}${file.by ? `, ${file.by === "you" ? "uploaded" : "made"}` : ""}`}
                title={`${file.name} · ${fileSize(file.size)}`}
                onclick={() => details.show(session.id, "file", file.name)}
              >
                <span class="thumb">
                  {#if fileKind(file.name) === "image"}<img src={fileUrl(session.id, file.name)} alt="" loading="lazy" />
                  {:else}<span class="ext" aria-hidden="true">{file.name.split(".").pop()?.slice(0, 5) || "file"}</span>{/if}
                </span>
                <span class="tile-name">{file.name}</span>
                {#if file.by}<span class="sub">{file.by === "you" ? "uploaded" : "made"}</span>{/if}
              </button>
            </li>{/each}
        </ul>
      </Fold>{/if}

    {#each panels as panel (panel.key)}<Fold title={panel.title ?? panel.key} tag="extension">
        <ContributionPoint point="session.details" only={panel.key} />
      </Fold>{/each}

    {#if forks.length}<Fold title="Forks" count={String(forks.length)}>
        {@render relatedRows("Forks", forks)}
      </Fold>{/if}

    {#if routines.length}<Fold title={`Routines of ${info.agent.name}`}>
        {#snippet action()}<button
            type="button"
            class="icon"
            aria-label="Show routines"
            title="Run now and recent runs"
            onclick={() => details.show(session.id, "routines")}><Icon name="expand" class="h-4 w-4" /></button
          >{/snippet}
        <ul class="rows" aria-label="Routines">
          {#each routines as routine (routine.id)}<li class="row">
              <span class="grow"
                ><span class="line">{routine.name}</span><span class="sub">{describeSchedule({ cron: routine.cron })}</span></span
              >
              <Toggle
                label={`Run ${routine.name}`}
                checked={routine.on}
                onchange={(event) => void switchRoutine(routine, (event.currentTarget as HTMLInputElement).checked)}
              />
            </li>{/each}
        </ul>
        {#if routineError}<p role="alert" class="note danger">{routineError}</p>{/if}
      </Fold>{/if}

  </div>
{/if}

{#if editing}<ScheduleDialog sessionId={session.id} schedule={editing === true ? undefined : editing} onclose={() => (editing = undefined)} />{/if}

{#snippet relatedRows(label: string, sessions: SessionInfo[])}
  <ul class="rows" aria-label={label}>
    {#each sessions as child (child.id)}
      {@const state = sessionState(child)}
      <li class="row">
        <button type="button" class="grow link line" onclick={() => client.open(child.id)}>{sessionName(child)}</button>
        {#if state}<StatusMark
            kind={state === "needs-you" ? "attention" : state === "failed" || state === "interrupted" ? "error" : state === "queued" ? "waiting" : "busy"}
            label={sessionStatus(child)}
            words
          />{:else}<span class="sub">Finished</span>{/if}
        {#if state === "working" || state === "queued"}<button
            type="button"
            class="icon"
            aria-label={`Stop ${sessionName(child)}`}
            title="Stop"
            onclick={() => void client.stop(child.id)}><Icon name="stop" class="h-4 w-4" /></button
          >{/if}
      </li>
    {/each}
  </ul>
{/snippet}

<style>
  .panels {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .facts {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    font-size: var(--text-sm);
  }
  .facts > div {
    display: flex;
    gap: 0.75rem;
    min-height: 1.75rem;
    align-items: baseline;
    padding: 0.125rem 0;
  }
  .facts dt {
    width: 5rem;
    flex-shrink: 0;
    color: var(--muted-foreground);
  }
  .facts dd {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* A value that changes (model, thinking) lines up with the values that don't. */
  .facts dd :global(.ui-selector) {
    margin-inline-start: -0.5rem;
    font-weight: 400;
  }
  .path {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .muted {
    color: var(--muted-foreground);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
    gap: 0.5rem;
    padding: 0.25rem 0 0.375rem;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    width: 100%;
    text-align: left;
    border-radius: var(--radius-sm);
  }
  .thumb {
    display: grid;
    place-items: center;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--muted);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .ext {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    color: var(--muted-foreground);
  }
  .tile:hover .thumb,
  .tile:focus-visible .thumb {
    border-color: var(--interactive);
  }
  .tile-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
  }
  .meter {
    height: 0.375rem;
    margin: 0.375rem 0 0.25rem;
    border-radius: var(--radius-full);
    background: var(--muted);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--foreground);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0.25rem 0;
  }
  .chips:empty {
    display: none;
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.25rem;
    font-size: var(--text-sm);
  }
  .grow {
    flex: 1;
    min-width: 0;
    text-align: left;
  }
  .line {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    display: block;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .note {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    padding: 0.125rem 0 0.25rem;
  }
  .danger {
    color: var(--danger-foreground);
  }
  .link {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
  }
  .icon:hover {
    background: var(--accent);
    color: var(--foreground);
  }
  :global([data-size="compact"]) .icon {
    width: 2.75rem;
    height: 2.75rem;
  }
  :global([data-size="compact"]) .row {
    min-height: 2.75rem;
  }
</style>
