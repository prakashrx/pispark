/**
 * The time now, for words like "3 min ago" and countdowns: ticking every `every` milliseconds while
 * `active` says something needs it, and not at all otherwise.
 */
export function useNow(active: () => boolean = () => true, every = 1000): { readonly now: number } {
  const clock = $state({ now: Date.now() });
  $effect(() => {
    if (!active()) return;
    clock.now = Date.now();
    const timer = setInterval(() => (clock.now = Date.now()), every);
    return () => clearInterval(timer);
  });
  return clock;
}
