import * as svelte from "svelte";
// @ts-expect-error Svelte ships no types for its internals; compiled components import them, PiSpark only shares them.
import * as client from "svelte/internal/client";
import * as store from "svelte/store";
import * as transition from "svelte/transition";
import * as animate from "svelte/animate";
import * as easing from "svelte/easing";
import * as motion from "svelte/motion";
import * as reactivity from "svelte/reactivity";
import * as events from "svelte/events";
import type { SHARED_SVELTE } from "../../../../server/src/contract/shared-svelte";

/**
 * The app's own Svelte, shared with extension components (the server compiles their `svelte`
 * imports to this object), so they run on the same runtime and mount inside PiSpark's tree.
 */
export const sharedSvelte: Record<(typeof SHARED_SVELTE)[number], object> = {
  svelte,
  "svelte/internal/client": client,
  // Compiled components import this only for its side effect, which the app already ran.
  "svelte/internal/disclose-version": {},
  "svelte/store": store,
  "svelte/transition": transition,
  "svelte/animate": animate,
  "svelte/easing": easing,
  "svelte/motion": motion,
  "svelte/reactivity": reactivity,
  "svelte/events": events,
};
(globalThis as { __pisparkSvelte?: object }).__pisparkSvelte = sharedSvelte;
