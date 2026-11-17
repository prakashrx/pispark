import { tick } from "svelte";

/** Size classes (design language §7): compact < 600 px, medium 600–1023, expanded ≥ 1024. */
export type Size = "compact" | "medium" | "expanded";

const COMPACT = "(max-width: 599.98px)";
const EXPANDED = "(min-width: 1024px)";
/** The side panel's width as a column: 380 px unless the person drags it (360–480). */
const PANEL = 380;
export const PANEL_MIN = 360;
export const PANEL_MAX = 480;
const PANEL_KEY = "pispark.panel-width";
const clampPanel = (value: number) => Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, value)));

/**
 * How the window is laid out: its size class, and where the sidebar is. Expanded keeps the
 * sidebar beside the screen (hideable with Ctrl+B); medium shows it as a drawer; compact makes
 * the session list the first screen.
 */
class Layout {
  size = $state<Size>("expanded");
  /** Expanded only: the person hid the sidebar. */
  sidebarHidden = $state(false);
  /** Medium only: the sidebar is open as a drawer. */
  drawerOpen = $state(false);
  /** The window's width, for whether a side panel fits beside the screen. */
  width = $state(1440);
  /** The side panel's width where it sits beside the screen. */
  panelWidth = $state(PANEL);

  constructor() {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const compact = window.matchMedia(COMPACT);
    const expanded = window.matchMedia(EXPANDED);
    const update = () => {
      this.size = compact.matches ? "compact" : expanded.matches ? "expanded" : "medium";
      if (this.size !== "medium") this.drawerOpen = false;
    };
    update();
    this.width = window.innerWidth;
    try {
      const saved = Number(localStorage.getItem(PANEL_KEY));
      if (saved) this.panelWidth = clampPanel(saved);
    } catch {
      /* The default width when browser storage is unavailable. */
    }
    window.addEventListener("resize", () => (this.width = window.innerWidth));
    compact.addEventListener("change", update);
    expanded.addEventListener("change", update);
  }

  get sidebarShown(): boolean {
    return this.size === "expanded" && !this.sidebarHidden;
  }
  /** A screen offers ☰ where the sidebar isn't on screen and isn't the screen itself. */
  get menuShown(): boolean {
    return this.size === "medium" || (this.size === "expanded" && this.sidebarHidden);
  }
  /**
   * A side panel (its width, 380 px unless resized) sits beside the screen when the screen keeps at least 30 rem: desktops
   * and landscape tablets. Otherwise it lays over the screen.
   */
  get panelFits(): boolean {
    const sidebar = this.sidebarShown ? 272 : 0;
    return this.size !== "compact" && this.width - sidebar - this.panelWidth >= 480;
  }
  /** The person resized the side panel; the width is remembered. */
  resizePanel(width: number) {
    this.panelWidth = clampPanel(width);
    try {
      localStorage.setItem(PANEL_KEY, String(this.panelWidth));
    } catch {
      /* Kept for this visit only. */
    }
  }
  /** ☰, Hide sidebar and Ctrl+B. Focus stays on the control that brings it back (or hides it). */
  toggleSidebar() {
    if (this.size === "medium") this.drawerOpen = !this.drawerOpen;
    else if (this.size === "expanded") {
      this.sidebarHidden = !this.sidebarHidden;
      const target = this.sidebarHidden ? "[data-sidebar-toggle]" : '[aria-label="Hide sidebar"]';
      void tick().then(() => document.querySelector<HTMLElement>(target)?.focus());
    }
  }
}

export const layout = new Layout();
