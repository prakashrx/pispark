# Architecture

**Product authority: [VISION.md](../VISION.md).** This document describes the implementation that exists, not an alternative product direction or a prescribed backend design. Evaluate proposed changes against the vision, especially its ownership boundaries and defining web-native extension capability.

## Implemented today

Two npm workspaces, with no shared package or framework layer:

- **`apps/server`**: Node's native HTTP server, written in TypeScript. `src/server.ts` creates a testable server; `src/index.ts` owns configuration, listening, and signal handling. `src/runtime/session-runtime.ts` adds an independently constructible session owner backed by pinned Pi SDK1.4.0; the HTTP entry point owns its startup and shutdown via `SessionHttp`.
- **`apps/web`**: Svelte 5 components compiled by Vite with local Tailwind CSS. `App.svelte` owns hash navigation; `routes.ts` and `RouteOutlet.svelte` map the four explicit routes (`#/workspace`, `#/settings`, `#/persona`, `#/sources`), plus the provider settings subroute `#/providers`. One `lib/layout/AppShell.svelte` owns the common sidebar frame and persistent global Ask. Generic typed controls live in `lib/ui`; feature components live in `features/workspace`, `settings`, `persona`, and `sources`; General shows read-only workspace configuration plus appearance preferences, and Sources marks connections unavailable. Provider sign-in, model browsing and disconnect happen inline in expandable provider rows. Settings and persona editing use an in-page `InlinePanel` (initial focus, Escape, focus return) instead of modal dialogs; item edits use its `editor` variant inside the item's own row (prompt text, files, reference settings, skill folders) and the persona name/description is edited in the page header. Chat info is a `Popover` on the chat header; the generic `Modal` primitive remains available but unused by first-party routes. The reply composer appears only while a chat is open; when one is, the global Ask recedes visually until focused or holding a draft. A small context-owned session client adapter owns transport, selected session and drafts. There is no router dependency or global state framework; browser storage holds only the selected UUID and the appearance preference.

**Themes.** `lib/theme/themes.css` defines each theme as a neutral RGB ramp (`--n-0` page surface … `--n-950` strongest text), a sidebar surface and an accent; every semantic token (`--background`, `--muted-foreground`, `--interactive`, status tints, shadows) derives from those, and Tailwind's `zinc`/`gray`/`neutral`/`white` utilities map onto the same ramp so existing components follow the active theme. `lib/theme/themes.ts` names the themes (Daylight, Paper, Mist; Midnight, Ocean, Ember; plus System), font stacks and text sizes; `appearance.svelte.ts` stores the browser-local choice under `pispark.appearance` and applies `data-theme`, `--font-sans`, `--font-reading` and the root font size before the first render. Fonts are system stacks; none are bundled.

In development, Vite serves the UI on loopback port 5173 and proxies `/api` to port 3000. In production, the compiled Node entry serves `apps/web/dist` relative to its own module location, not the working directory.

### HTTP surface

| Route | Behavior |
| --- | --- |
| `GET /api/health` | `200` with `{ "status": "ok", "service": "pispark" }` |
| Other methods on `/api/health` | `405`, with `Allow: GET` |
| `/api/catalog`, `/api/sessions`, `/api/commands`, `/api/receipts/*`, session `/events` and `/window` | [Bounded session protocol](session-protocol.md), strict local Host/Origin validation |
| `/api/providers` and `/api/providers/*` | Native provider catalog, default/refresh/logout and owner-capability sign-in bridge; same local security guard |
| `/api/personas` and `/api/personas/*` | [Bounded local persona management](personas.md), validation/revision-checked writes and effective provenance; same guard |
| Unknown `/api` routes | JSON `404`, never frontend HTML |
| `GET` / `HEAD` `/` | Built HTML entry, or `404` if not built |
| `GET` / `HEAD` `/favicon.svg`, `/assets/*` | Existing permitted build assets, or `404` |
| Other eligible frontend GET paths | Built SPA entry, or `404` when unavailable |

Static paths are decoded once, reject dot/hidden segments, nulls and backslashes, and must remain within the build root after resolving symlinks. Supported asset types are explicit. Builds are trusted local files, not user uploads. Requests are uncached in this starter. This intentionally small server is not a general-purpose static hosting service.

The workspace uses real configured sessions and native messages/tool results through typed view state, not fixture conversations. Ask uses admitted backend workspace keys, saved personas, independent model selection and an advanced trusted host-policy choice. Style remains unavailable. The status indicator reports actual client connectivity, not provider health; when not connected it also says "Offline" or "Connecting…" in words. Providers & models is backed by native Pi auth/catalog/default persistence. Persona management uses real backend persistence; General saves browser-local appearance preferences and displays read-only host configuration. Sources shows that connections are unavailable. Ask and independent session drafts survive route changes in memory; reload discards drafts and reconnects to the selected UUID. The browser may submit transient native secret/code responses through the sign-in bridge; no arbitrary native-file paths, provider configurations or secret references are accepted.

Hash routes need no server SPA fallback. Material Symbols is bundled locally under `/assets/` with its Apache 2.0 license and provenance in `apps/web/src/assets/fonts/`; no runtime CDN is used. Its `Symbol` wrapper is kept for future use; current screens use the inline SVG icons in `lib/ui/icons.ts`.

The entry point binds only literal loopback, logs its listening address and handles SIGINT/SIGTERM by closing observers and draining the runtime, allowing up to five seconds before closing remaining HTTP connections. Cooperative runtime cleanup retains ownership until it actually finishes. Windows process managers may force-terminate rather than deliver POSIX signals.

## Internal runtime foundation

The [session runtime](session-runtime.md) owns explicit workspace/configuration keys, concurrent native AgentSessions, bounded pull-based snapshot observation, cancellation and graceful unload. Pi owns tools/model execution, native extension lifecycle and canonical JSONL context. A small host metadata file records identity, empty sessions and interrupted activity; there is no parallel transcript database. Native extension loading is exact-path, with no ambient project/home resources or terminal Pi storage. Native provider auth intentionally retains operator process environment/ambient semantics.

Every hosted session loads the ordinary built-in PiSpark integration extension; its first capability is a session-bound native title tool, not a public RPC framework. See [capability scope and lifetime](session-runtime.md#built-in-pispark-session-integration).

Real-SDK tests use a deterministic local provider, including two simultaneous sessions and killed-process recovery without tool replay. This is not external paid-provider verification. The current same-process policy admits trusted local code only, not sandboxed third-party execution. Compatibility and recovery limits are documented with the runtime API.

## Persona and observability foundation

Concrete modules under `src/personas` own strict definitions, bounded filesystem persistence, deterministic ordered composition and session admission. They do not own model execution or parse an alternate skill format. The existing native ResourceLoader consumes admitted instructions/standard skill copies; SessionManager remains the sole canonical transcript owner. Recovery verifies captured inputs and host policy without silently rereading changed sources. The shared client owns real persona/file drafts, independent saved Ask selection and explicit collection/editor navigation intent. Feature-local collection, metadata/resource panels and preview compose generic `lib/ui` fields, buttons, menus, inline panel focus/dismissal, checkboxes, native radios and searchable/token selectors; the persona screens have no tab strip. The generic `Tabs`, `Toggle` and `FieldGroup` primitives are kept for future use but no route uses them yet. Controls own default appearance and keyboard behavior, never domain requests; features own resource meaning and API calls. No new router or persona schema is involved. `src/logger.ts` projects an allowlist into a serialized bounded sink, without credential/content/native-cause serialization. See [persona contracts and trust limits](personas.md).

## Next phase: follow the vision, then propose the smallest design

[VISION.md §11](../VISION.md#11-direction-for-the-next-development-phase) governs the next phase: inspect Pi's current SDK and extension APIs, identify what PiSpark genuinely needs to own, propose the smallest coherent backend design, surface unresolved decisions, and obtain approval before substantial implementation.

The existing fixtures are UI examples—not a persona schema, native Pi event model, resource format, or transport contract. Do not derive a competing agent framework from them. Pi remains responsible for agent execution and its native lifecycle; PiSpark hosts independent concurrent sessions and clients without inheriting terminal configuration implicitly.

[Web-native Pi extensions](../VISION.md#7-web-native-pi-extensions) must inform foundational decisions. Ordinary Pi extensions may own Svelte components and domain-specific interactions; PiSpark supplies placement, lifecycle, and communication hosting. Conceptual `host.call()` / `host.on()` semantics do not establish a shipped API, transport choice, mandatory manifest, or separate extension ecosystem. The first-party component library is not a limit on extension presentation. Third-party code loading remains a trust decision requiring explicit design.

Worker isolation, further persona resource types and extension UI hosting remain unimplemented. The initial [HTTP/SSE protocol](session-protocol.md) is implemented without freezing a future extension communication API. Keep proposals distinct from implementation facts, and return to VISION.md when evaluating these choices.
