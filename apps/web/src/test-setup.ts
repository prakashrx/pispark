/** jsdom has no layout, so it has no observers of it; components that watch size or visibility get inert ones. */
class Inert {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver ??= Inert as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= Inert as unknown as typeof IntersectionObserver;
// Nor does it scroll.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
