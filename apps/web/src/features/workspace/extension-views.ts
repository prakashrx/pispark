import type { Component } from "svelte";
import type { ExtensionContribution, ExtensionView } from "../../../../server/src/contract/protocol";
import type { Segment } from "./chat-turns";

/**
 * Components extensions contribute to a session's points with Pi's event bus. The server compiles them
 * against the app's own Svelte; here they are imported once per compiled url and mounted by
 * `ContributionPoint` wherever their point is.
 */

// SAFETY: an extension component takes whatever props its extension sends; PiSpark adds its point's data.
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

/** What extensions contributed to one point, in the order they did. */
export const contributionsFor = (view: ExtensionView | undefined, point: string): ExtensionContribution[] =>
  view?.views.filter((contribution) => contribution.point === point) ?? [];

/** The points that have at least one contribution. */
export const placedPoints = (view: ExtensionView | undefined): Set<string> =>
  new Set(view?.views.map((contribution) => contribution.point) ?? []);

/**
 * Where a part of a turn can be drawn by an extension, and what its component gets as `data`:
 * a tool's output gets the call, a custom message or entry gets the item.
 */
export function pointOf(segment: Segment): { point: string; data: unknown } | undefined {
  if (segment.kind === "view") return { point: segment.point, data: segment.call };
  if (segment.kind === "custom" && segment.item.customType)
    return { point: `item.custom:${segment.item.customType}`, data: segment.item };
  return undefined;
}
