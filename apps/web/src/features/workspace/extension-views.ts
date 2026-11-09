import type { Component } from "svelte";
import type { ExtensionContribution, ExtensionView } from "../../../../server/src/protocol";
import type { AnySegment } from "./chat-turns";
import { registerToolView, resolveToolView } from "./views.svelte";

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

/**
 * A `tool:<name>` contribution: the tool's calls show the extension's component in the message,
 * under the call. What PiSpark already says about the tool (its words, summary, opened row) stays;
 * the component replaces the default pictures and diffs. Returns a function that undoes it.
 */
export function registerToolSlot(tool: string): () => void {
  const base = resolveToolView(tool);
  const slot = `tool:${tool}`;
  return registerToolView(tool, {
    ...base,
    artifacts: (call): AnySegment[] => [{ kind: "view", key: `view.${call.id}`, slot, call }],
  });
}
