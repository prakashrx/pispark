/**
 * The parts of Svelte an extension component may import. The page shares exactly these, from the
 * app's own Svelte instance, as `globalThis.__pisparkSvelte`; the server compiles imports of them to
 * that object. One Svelte runtime, so extension components mount inside PiSpark's tree.
 */
export const SHARED_SVELTE = [
  "svelte",
  "svelte/internal/client",
  "svelte/internal/disclose-version",
  "svelte/store",
  "svelte/transition",
  "svelte/animate",
  "svelte/easing",
  "svelte/motion",
  "svelte/reactivity",
  "svelte/events",
] as const;
