<script lang="ts">
  /**
   * A session's screen (set 3): its name, state and actions in the top bar; its notices; the
   * conversation (or the view an extension offers) as Main, the screen's only scroll; and the
   * dock: the shelf, the reply box and the status line. Its Details sit in the side panel beside
   * it (design language §1.5), or on compact are screens of their own.
   */
  import { untrack } from "svelte";
  import Menu from "../../lib/ui/Menu.svelte";
  import { href } from "../../routes";
  import Screen from "../../shell/Screen.svelte";
  import SidePanel from "../../shell/SidePanel.svelte";
  import { layout } from "../../shell/layout.svelte";
  import { router } from "../../shell/router.svelte";
  import Composer from "./Composer.svelte";
  import ReadOnlyReply from "./ReadOnlyReply.svelte";
  import ContributionPoint from "./ContributionPoint.svelte";
  import SessionArea from "./SessionArea.svelte";
  import SessionBar from "./SessionBar.svelte";
  import SessionDetails, { detailsTitle } from "./SessionDetails.svelte";
  import SessionNotices from "./SessionNotices.svelte";
  import SessionTabs from "./SessionTabs.svelte";
  import Shelf from "./Shelf.svelte";
  import StatusLine from "./StatusLine.svelte";
  import { details } from "./details.svelte";
  import type { Session } from "./session.svelte";
  import { provideSession, useSessions } from "./session-client.svelte";
  import { canArchive, sessionName } from "./session-presentation";

  let { session }: { session: Session } = $props();
  // svelte-ignore state_referenced_locally
  provideSession(session);
  const client = useSessions();
  const name = $derived(session.info ? sessionName(session.info) : "Session");
  let renaming = $state(false);
  // Looking at it reads it (L-17): when it is on screen and the page is in view.
  let visible = $state(typeof document === "undefined" || document.visibilityState === "visible");
  $effect(() => {
    const update = () => (visible = document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  });
  $effect(() => {
    if (session.info?.unread && visible) void client.seen(session.id);
  });
  const agent = $derived(session.info?.agent.name);
  const view = $derived(session.views.find((offer) => offer.key === session.shownView));
  const compact = $derived(layout.size === "compact");
  // An extension's window title names the browser tab while this session is open.
  $effect(() => {
    const title = session.doc?.extensions.title;
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  });

  // The address may name a view of Details: on compact that is the screen; wider, the side panel
  // opens on it and the address goes back to the session's own.
  const panelRoute = $derived(router.route.name === "session" && router.route.id === session.id ? router.route.panel : undefined);
  $effect(() => {
    const opened = panelRoute;
    if (compact || !opened) return;
    untrack(() => {
      details.show(session.id, opened, details.focus(session.id));
      history.replaceState(history.state, "", href({ name: "session", id: session.id }));
      router.sync();
    });
  });
  const side = $derived(compact ? undefined : details.view(session.id));
  // Details' own actions: editing the agent for this session is an action, not a panel.
  const detailsActions = $derived([
    ...(session.doc ? [{ id: "edit-agent", label: "Edit agent for this session", onselect: () => details.show(session.id, "agent") }] : []),
    ...(session.info && canArchive(session.info) ? [{ id: "archive", label: "Archive", onselect: () => void client.archive(session.id) }] : []),
  ]);
</script>

{#snippet tabs()}<SessionTabs />{/snippet}
{#snippet detailsMenu()}{#if detailsActions.length}<Menu label="Details actions" items={detailsActions} />{/if}{/snippet}

{#if compact && panelRoute}
  <Screen
    title={detailsTitle(panelRoute, agent)}
    back={panelRoute === "details" ? { name: "session", id: session.id } : { name: "session", id: session.id, panel: "details" }}
  >
    {#snippet actions()}{#if panelRoute === "details"}{@render detailsMenu()}{/if}{/snippet}
    <SessionDetails view={panelRoute} focus={details.focus(session.id)} />
  </Screen>
{:else}
  <Screen title={name} rename={session.info ? (title) => session.rename(title) : undefined} bind:renaming flush scroll={!view} below={compact && session.views.length ? tabs : undefined}>
    {#snippet actions()}<SessionBar tabs={!compact} onrename={() => (renaming = true)} />{/snippet}
    {#snippet notices()}<SessionNotices />{/snippet}
    <SessionArea {session} />
    {#snippet dock()}
      <!-- An extension's view has the screen; the reply box steps aside. -->
      {#if !view}
        <Shelf />
        {#if session.doc?.readOnly}<ReadOnlyReply />{:else}<Composer mode="reply" />{/if}
        <ContributionPoint point="session.input.below" />
        <StatusLine />
      {/if}
    {/snippet}
  </Screen>
  {#if side}
    <SidePanel
      title={detailsTitle(side, agent)}
      over={!layout.panelFits}
      expanded={side !== "details" && details.expanded}
      wantsFocus={details.wantsFocus}
      onfocused={() => (details.wantsFocus = false)}
      onexpand={side === "details" ? undefined : (expanded) => (details.expanded = expanded)}
      onback={side === "details" ? undefined : () => details.back(session.id)}
      backLabel="Back to Details"
      onclose={() => details.close(session.id)}
      closeLabel="Close Details"
    >
      {#snippet actions()}{#if side === "details"}{@render detailsMenu()}{/if}{/snippet}
      <SessionDetails view={side} focus={details.focus(session.id)} />
    </SidePanel>
  {/if}
{/if}
