# Architecture

## Implemented today

Two npm workspaces, with no shared package or framework layer:

- **`apps/server`**: Node's native HTTP server, written in TypeScript. `src/server.ts` creates a testable server; `src/index.ts` owns configuration, listening, and signal handling. It has no runtime npm dependencies.
- **`apps/web`**: Svelte 5 components compiled by Vite. `App.svelte` composes the sidebar, demo composer, and health indicator. There is no client router, store framework, or persistence.

In development, Vite serves the UI on loopback port 5173 and proxies `/api` to port 3000. In production, the compiled Node entry serves `apps/web/dist` relative to its own module location, not the working directory.

### HTTP surface

| Route | Behavior |
| --- | --- |
| `GET /api/health` | `200` with `{ "status": "ok", "service": "pispark" }` |
| Other methods on `/api/health` | `405`, with `Allow: GET` |
| Unknown `/api` routes | JSON `404`, never frontend HTML |
| `GET` / `HEAD` `/` | Built HTML entry, or `404` if not built |
| `GET` / `HEAD` `/favicon.svg`, `/assets/*` | Existing permitted build assets, or `404` |
| Other paths | `404`; no SPA fallback |

Static paths are decoded once, reject dot/hidden segments, nulls and backslashes, and must remain within the build root after resolving symlinks. Supported asset types are explicit. Builds are trusted local files, not user uploads. Requests are uncached in this starter. This intentionally small server is not a general-purpose static hosting service.

The UI requests health on mount, every 30 seconds, and on refresh, with a five-second timeout and response-shape validation. “Backend online” means the HTTP health check succeeded, **not** that a model or agent is connected. The demo composer performs no network request and stores nothing beyond component memory.

The entry point logs its listening address and handles SIGINT/SIGTERM by closing the server, allowing up to five seconds before closing remaining connections. Windows process managers may force-terminate rather than deliver POSIX signals.

## Next seam: Pi SDK integration

Integrate the SDK inside the backend, not inside a Svelte component and not by launching terminal Pi. Keep PiSpark resources and sessions independent of any terminal installation, configuration, or session history. Use explicit configuration/resource loading rather than ambient discovery.

Before implementation, verify the current SDK API and agree on the minimum session lifecycle and event contract. A headless backend should be able to own a session without a browser attached. A later web or messaging adapter should communicate with that runtime, rather than become the owner of it.

No session manager, event transport, worker isolation, database, plugin API, persona schema, or SDK compatibility promise is implemented or finalized here. Add boundaries when the first real integration demonstrates the need.
