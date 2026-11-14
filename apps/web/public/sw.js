// PiSpark's service worker: makes the app installable and lets its window open while the server
// restarts (an update). It keeps only the app shell: the page is fetched fresh every time and the
// stored copy is used only when the server cannot be reached; hashed build files are kept once
// fetched. Nothing under /api is ever stored.
const CACHE = "pispark-shell";
const KEEP = 200;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(async () => (await caches.match("/")) ?? Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE).then(async (cache) => {
                await cache.put(request, copy);
                const keys = await cache.keys();
                for (const old of keys.slice(0, Math.max(0, keys.length - KEEP))) await cache.delete(old);
              });
            }
            return response;
          }),
      ),
    );
  }
});
