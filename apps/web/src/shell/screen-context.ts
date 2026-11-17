import { getContext } from "svelte";

/** The screen around a component: its main region, which is the screen's only scroll. */
export const useScreen = () => getContext<{ readonly main: HTMLElement | undefined } | undefined>("screen");
