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

// Notifications (design set 9). A push carries nothing: what to show is read here from PiSpark, so
// the browser's push service learns only that something happened. If PiSpark can't be reached, a
// plain notice still shows (a browser requires one for every push).
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let list = [];
      try {
        const subscription = await self.registration.pushManager.getSubscription();
        if (subscription) {
          const response = await fetch("/api/notifications/pending", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          if (response.ok) list = (await response.json()).notifications ?? [];
        }
      } catch {
        /* out of reach: the plain notice below */
      }
      if (!list.length) list = [{ title: "PiSpark", body: "A session may need you.", url: "/#/", tag: "pispark" }];
      await Promise.all(
        list.map((each) =>
          self.registration.showNotification(each.title, { body: each.body, tag: each.tag, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: each.url } }),
        ),
      );
    })(),
  );
});

// Tapping one opens PiSpark at that session: an open window goes there, else a new one opens.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === url.origin);
      if (open) {
        await open.focus();
        open.postMessage({ type: "pispark:open", hash: url.hash });
        return;
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
