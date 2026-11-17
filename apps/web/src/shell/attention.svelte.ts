/**
 * What the app tells you in passing (design set 9). Two places, so they never mean the same thing:
 * a toast at the bottom is the result of what you did ("Archived … · Undo"); the nudge at the top is
 * something elsewhere that needs you. One of each at a time; each leaves on its own.
 */
export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
export interface Nudge {
  /** The session that needs you. */
  id: string;
  name: string;
  /** Its agent's name, for the mark. */
  agent: string;
}

const TOAST_MS = 6000;
const NUDGE_MS = 8000;

class Attention {
  toast = $state<Toast>();
  nudge = $state<Nudge>();
  private count = 0;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private nudgeTimer?: ReturnType<typeof setTimeout>;

  /** Says what just happened, with one way to take it back. */
  say(text: string, action?: Toast["action"]) {
    this.toast = { id: ++this.count, text, action };
    this.holdToast(false);
  }
  /** Keeps the toast while the pointer or focus is on it; lets it go again after. */
  holdToast(held: boolean) {
    clearTimeout(this.toastTimer);
    if (!held && this.toast) this.toastTimer = setTimeout(() => this.dismissToast(), TOAST_MS);
  }
  dismissToast() {
    clearTimeout(this.toastTimer);
    this.toast = undefined;
  }

  /** Another session needs you. */
  needsYou(id: string, name: string, agent = name) {
    this.nudge = { id, name, agent };
    this.holdNudge(false);
  }
  holdNudge(held: boolean) {
    clearTimeout(this.nudgeTimer);
    if (!held && this.nudge) this.nudgeTimer = setTimeout(() => this.dismissNudge(), NUDGE_MS);
  }
  dismissNudge() {
    clearTimeout(this.nudgeTimer);
    this.nudge = undefined;
  }
}

export const attention = new Attention();
