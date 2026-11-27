import { tick } from "svelte";
import { go, type DetailsView } from "../../routes";
import { layout } from "../../shell/layout.svelte";
import { router } from "../../shell/router.svelte";

const KEY = "pispark.details";
const read = (): boolean | undefined => {
  try {
    const value = localStorage.getItem(KEY);
    return value === "open" ? true : value === "closed" ? false : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A session's side panel (design language §1.5): whether its Details show, and which view opened
 * from them. Where the panel fits beside the conversation, Details are open by default and the
 * person's choice is remembered; where it lays over the conversation, it starts closed. On compact
 * Details are screens with their own address, so this only routes there.
 */
class Details {
  /** Open or closed by the person, where the panel fits; undefined until they choose. */
  private choice = $state<boolean | undefined>(read());
  /** Where the panel lays over the conversation: the session it was opened for. */
  private over = $state<string>();
  /** A view opened from Details (schedules, output…), for the session it was opened in. */
  private opened = $state<{ sessionId: string; view: Exclude<DetailsView, "details">; focus?: string }>();
  /** The panel has the whole screen for a moment (a long output, the agent editor). */
  expanded = $state(false);
  /** The person opened the panel: it takes focus once it shows. */
  wantsFocus = $state(false);

  /** What the side panel shows for a session; undefined while it is closed. */
  view(sessionId: string): DetailsView | undefined {
    if (this.opened?.sessionId === sessionId) return this.opened.view;
    const open = layout.panelFits ? (this.choice ?? true) : this.over === sessionId;
    return open ? "details" : undefined;
  }
  /** What the view opened on: a process, for its output. */
  focus(sessionId: string): string | undefined {
    return this.opened?.sessionId === sessionId ? this.opened.focus : undefined;
  }

  /** The top bar's Details button. */
  toggle(sessionId: string) {
    const shown = this.view(sessionId) !== undefined;
    this.opened = undefined;
    this.expanded = false;
    this.setOpen(sessionId, !shown);
    if (shown) focusToggle();
    else this.wantsFocus = true;
  }
  /** Opens a session's Details on a view: its screen on compact, the side panel wider. */
  show(sessionId: string, view: DetailsView = "details", focus?: string) {
    this.expanded = false;
    this.opened = view === "details" ? undefined : { sessionId, view, focus };
    if (layout.size === "compact") return go({ name: "session", id: sessionId, panel: view });
    if (view === "details") this.setOpen(sessionId, true);
    this.wantsFocus = true;
    const route = router.route;
    if (route.name !== "session" || route.id !== sessionId) go({ name: "session", id: sessionId });
  }
  /** From a view back to Details. */
  back(sessionId: string) {
    this.opened = undefined;
    this.expanded = false;
    this.setOpen(sessionId, true);
    this.wantsFocus = true;
  }
  /** The panel's Close: the view goes, and Details close too. */
  close(sessionId: string) {
    this.opened = undefined;
    this.expanded = false;
    this.setOpen(sessionId, false);
    focusToggle();
  }

  private setOpen(sessionId: string, open: boolean) {
    if (!layout.panelFits) return void (this.over = open ? sessionId : undefined);
    this.choice = open;
    try {
      localStorage.setItem(KEY, open ? "open" : "closed");
    } catch {
      // Not remembered; it still opens and closes.
    }
  }
}

function focusToggle() {
  void tick().then(() => document.querySelector<HTMLElement>("[data-details-toggle]")?.focus());
}

export const details = new Details();
