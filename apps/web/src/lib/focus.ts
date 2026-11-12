/** Moves focus to the page's main region, as after a route change: screen readers start there. */
export function focusMain() {
  const main = document.querySelector("main");
  main?.setAttribute("tabindex", "-1");
  main?.focus({ preventScroll: true });
}
