// PiSpark's service worker: makes the app installable and lets its window open while the server
// restarts (an update), also through a proxy such as Tailscale Serve. It keeps only the app shell:
// the page is fetched fresh every time and the stored copy is used only when the server cannot be
// reached; hashed build files are kept once fetched. Nothing under /api is ever stored.
const CACHE = "pispark-shell";
const KEEP = 200;
/** What a proxy answers while the server behind it is away. */
const PROXY_DOWN = new Set([502, 503, 504]);

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
        .then(async (response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put("/", copy));
            return response;
          }
          // Through a proxy (Tailscale Serve) a stopped server is the proxy's error page, not a failed
          // connection: open the stored app then too.
          if (PROXY_DOWN.has(response.status)) return (await caches.match("/")) ?? response;
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
