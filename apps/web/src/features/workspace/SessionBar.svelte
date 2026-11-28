<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Menu from "../../lib/ui/Menu.svelte";
  import StatusMark, { type StatusKind } from "../../lib/ui/StatusMark.svelte";
  import { layout } from "../../shell/layout.svelte";
  import ContributionPoint from "./ContributionPoint.svelte";
  import SessionTabs from "./SessionTabs.svelte";
  import WorkingFrames from "./WorkingFrames.svelte";
  import { details } from "./details.svelte";
  import { canArchive, elapsed, sessionName, sessionState, sessionStatus, STATE_WORDS, type SessionState } from "./session-presentation";
  import { useNow } from "../../lib/clock.svelte";
  import { useSession, useSessions } from "./session-client.svelte";
  import { attention } from "../../shell/attention.svelte";
  import { href } from "../../routes";
  import CommandPicker from "./CommandPicker.svelte";

  /**
   * What a session's top bar holds after its name (design language §1.2): an extension's title
   * chips (where there is room), its state, the switch between its views, Details, and ⋯.
   */
  let { tabs = true, onrename }: { tabs?: boolean; onrename?: () => void } = $props();
  const client = useSessions();
  const session = useSession();
  const doc = $derived(session.doc);
  const info = $derived(session.info);
  const compact = $derived(layout.size === "compact");

  // While running, an extension may relabel, re-animate or hide the working indicator.
  const working = $derived(info?.status === "running" ? doc?.extensions.working : undefined);
  // "Opening" only when opening takes long enough to notice, so a quick switch shows nothing.
  let slowOpening = $state(false);
  $effect(() => {
    if (!session.opening) return void (slowOpening = false);
    const timer = setTimeout(() => (slowOpening = true), 300);
    return () => clearTimeout(timer);
  });
  const current = $derived<SessionState>(
    (session.opening && slowOpening) || client.connection === "Connecting" || client.connection === "Loading"
      ? "opening"
      : sessionState(info),
  );
  const kinds: Record<Exclude<SessionState, "">, StatusKind> = {
    "needs-you": "attention",
    failed: "error",
    interrupted: "error",
    working: "busy",
    opening: "busy",
    stopping: "busy",
    queued: "waiting",
  };
  // A question waiting or a queued prompt is said as it is; otherwise an extension may word it.
  const label = $derived(
    current === "opening"
      ? STATE_WORDS.opening
      : current === "working" && doc?.compacting
        ? "Compacting context"
        : current === "working" && working?.message
          ? working.message
          : sessionStatus(info),
  );

  // How long the reply has run, from when Pi recorded the message it answers.
  // A message waiting for a summary first has no reply running yet.
  const since = $derived(
    current === "working" && !(doc?.compacting && doc.queuedText) ? session.items.findLast((item) => item.role === "user")?.at : undefined,
  );
  const clock = useNow(() => since !== undefined);
  // A command runs as if it were typed in the reply box and sent, so it needs what a reply needs.
  const ready = $derived(doc?.status === "idle" && !doc.compacting && session.connection === "Live" && !client.busy);
  let picking = $state(false);
  async function copyLink() {
    const link = new URL(href({ name: "session", id: session.id }), location.href).href;
    try {
      await navigator.clipboard.writeText(link);
      attention.say("Link copied");
    } catch {
      attention.say("Couldn’t copy the link");
    }
  }
  let forking = $state(false);
  async function fork() {
    forking = true;
    try {
      const id = await session.fork();
      if (id) {
        await client.refresh();
        client.open(id);
      }
    } catch (error) {
      attention.say((error as Error).message);
    } finally {
      forking = false;
    }
  }
  // The session ⋯ menu (design set 7/3).
  const actions = $derived([
    ...(onrename && info ? [{ id: "rename", label: "Rename", onselect: onrename }] : []),
    { id: "details", label: "Details", onselect: () => details.show(session.id) },
    ...(doc?.commands?.length ? [{ id: "commands", label: "Commands…", onselect: () => (picking = true) }] : []),
    ...(info?.hasHistory && !forking && !doc?.compacting && ["idle", "error", "read-only"].includes(info.status)
      ? [{ id: "fork", label: "Fork session", onselect: () => void fork() }]
      : []),
    // Starts the session again from its transcript with its agent as it is now; while it works, once it's done.
    ...(doc && !doc.readOnly && !doc.pending?.reload && !["starting", "stopping"].includes(doc.status)
      ? [{ id: "reload", label: "Reload session", onselect: () => void session.reload() }]
      : []),
    { id: "copy-link", label: "Copy link", onselect: () => void copyLink() },
    ...(info && canArchive(info) ? [{ id: "archive", label: "Archive", onselect: () => void client.archive(session.id) }] : []),
  ]);
</script>

{#if layout.size === "expanded"}<ContributionPoint point="session.title" />{/if}
{#if current && !(working?.hidden && current === "working")}<span class="state" role="status">
    <!-- An extension's frames stand for working only; needing you keeps its own mark. -->
    {#if working?.frames && current === "working"}<WorkingFrames frames={working.frames} intervalMs={working.intervalMs} /><span
        class:sr-only={compact}>{label}</span
      >
    {:else}<StatusMark kind={kinds[current]} {label} words={!compact} detail={since ? elapsed(clock.now - since) : undefined} />{/if}
  </span>{/if}
{#if tabs}<SessionTabs />{/if}
<!-- Details: the side panel beside the conversation, or their own screen on compact. -->
<Button
  variant="ghost"
  size="compact"
  data-details-toggle
  aria-label="Details"
  title="Details"
  aria-pressed={compact ? undefined : details.view(session.id) !== undefined}
  onclick={() => (compact ? details.show(session.id) : details.toggle(session.id))}><Icon name="panel" class="h-[18px] w-[18px]" /></Button
>
<Menu label="Session actions" title={sessionName(info)} items={actions} />
{#if picking && doc}<CommandPicker
    commands={doc.commands}
    {ready}
    onrun={(name) => void session.send(`/${name}`)}
    onclose={() => (picking = false)}
  />{/if}

<style>
  .state {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0 0.375rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
    white-space: nowrap;
  }
</style>
