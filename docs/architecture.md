# Architecture

## Implemented today

Two npm workspaces, with no shared package or framework layer:

- **`apps/server`**: Node's native HTTP server, written in TypeScript. `src/server.ts` creates a testable server; `src/index.ts` owns configuration, listening, and signal handling. It has no runtime npm dependencies.
- **`apps/web`**: Svelte 5 components compiled by Vite with local Tailwind CSS. `App.svelte` owns hash navigation; `routes.ts` and `RouteOutlet.svelte` map the four explicit routes (`#/workspace`, `#/settings`, `#/persona`, `#/sources`). One `lib/layout/AppShell.svelte` owns the common sidebar frame and persistent global Ask. Generic typed controls live in `lib/ui`; feature components and typed fixtures live in `features/workspace`, `settings`, `persona`, and `sources`. There is no router dependency, global store framework, or persistence.

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

The UI does not request backend health or call any backend operation. Its status dot, conversation, sessions, source locations/statuses, and version badge are display fixtures; even “Active” sources are not connected. Global Ask selections/draft and the independent reply draft survive route changes in application memory. Other form edits are local component state; reload discards all edits. Folder suggestions are fixture text, not browser or backend filesystem access. Backend-dependent actions remain unavailable rather than simulating successful runs or saves.

Hash routes need no server SPA fallback. Material Symbols is bundled locally under `/assets/` with its Apache 2.0 license and provenance in `apps/web/src/assets/fonts/`; no runtime CDN is used.

The entry point logs its listening address and handles SIGINT/SIGTERM by closing the server, allowing up to five seconds before closing remaining connections. Windows process managers may force-terminate rather than deliver POSIX signals.

## Next seam: Pi SDK integration

Integrate the SDK inside the backend, not inside a Svelte component and not by launching terminal Pi. Keep PiSpark resources and sessions independent of any terminal installation, configuration, or session history. Use explicit configuration/resource loading rather than ambient discovery.

Before implementation, verify the current SDK API and agree on the minimum session lifecycle and event contract. A headless backend should be able to own a session without a browser attached. A later web or messaging adapter should communicate with that runtime, rather than become the owner of it.

The frontend suggests future commands for starting a session, replying/cancelling, resolving folders, saving preferences/personas, and managing sources. Its transcript would need ordered per-session/message updates, snapshots, and reconnect/replay with failure isolation. These are integration requirements to discuss, not an implemented or finalized protocol. Independent concurrent sessions belong to the backend runtime.

No session manager, event transport, worker isolation, database, plugin API, persona schema, or SDK compatibility promise is implemented or finalized here. Add boundaries when the first real integration demonstrates the need.
