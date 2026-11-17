/** The time now, ticking once a second only while `active` says something is running. */
export function useNow(active: () => boolean): { readonly now: number } {
  const clock = $state({ now: Date.now() });
  $effect(() => {
    if (!active()) return;
    clock.now = Date.now();
    const timer = setInterval(() => (clock.now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  return clock;
}
