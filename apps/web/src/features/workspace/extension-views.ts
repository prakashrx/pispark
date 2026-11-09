import type { Component } from "svelte";
import type { ExtensionContribution, ExtensionView } from "../../../../server/src/protocol";
import type { Segment } from "./chat-turns";

/**
 * Components extensions place in the chat's slots with Pi's event bus. The server compiles them
 * against the app's own Svelte; here they are imported once per compiled url and mounted by
 * `ViewSlot` wherever their slot is.
 */

// SAFETY: an extension component takes whatever props its extension sends; PiSpark adds its slot's data.
export type ExtensionComponent = Component<any>;

const modules = new Map<string, Promise<ExtensionComponent>>();

/** Imports a compiled extension component; each url is imported once. */
export function loadView(url: string): Promise<ExtensionComponent> {
  let loading = modules.get(url);
  if (!loading) {
    // The shared runtime is set up with the first extension view, not with the app.
    loading = import("./extension-runtime")
      // An absolute URL, so the dev server's import rewriting (which adds `?import`) leaves it alone.
      .then(() => import(/* @vite-ignore */ new URL(url, location.href).href))
      .then((module: { default?: unknown }) => {
        if (typeof module.default !== "function") throw new Error("The view has no component");
        return module.default as ExtensionComponent;
      });
    // A failed import is tried again the next time the chat shows it.
    loading.catch(() => modules.delete(url));
    modules.set(url, loading);
  }
  return loading;
}

/** What extensions placed in one slot, in the order they placed it. */
export const contributionsFor = (view: ExtensionView | undefined, slot: string): ExtensionContribution[] =>
  view?.views.filter((contribution) => contribution.slot === slot) ?? [];

/** The slots that have at least one placement. */
export const placedSlots = (view: ExtensionView | undefined): Set<string> =>
  new Set(view?.views.map((contribution) => contribution.slot) ?? []);

/**
 * Where a part of a turn can be drawn by an extension, and what its component gets as `data`:
 * a tool's output gets the call, a custom message or entry gets the item.
 */
export function slotOf(segment: Segment): { slot: string; data: unknown } | undefined {
  if (segment.kind === "view") return { slot: segment.slot, data: segment.call };
  if (segment.kind === "custom" && segment.item.customType)
    return { slot: `custom:${segment.item.customType}`, data: segment.item };
  return undefined;
}
