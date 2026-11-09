# Architecture

**Product authority: [VISION.md](../VISION.md).** This document describes the implementation that exists, not an alternative product direction or a prescribed backend design. Evaluate proposed changes against the vision, especially its ownership boundaries and defining web-native extension capability.

## Implemented today

Two npm workspaces, with no shared package or framework layer:

- **`apps/server`**: Node's native HTTP server, written in TypeScript. `src/server.ts` creates a testable server; `src/index.ts` owns configuration, listening, and signal handling. `src/runtime/session-runtime.ts` adds an independently constructible session owner backed by pinned Pi SDK 1.5.0; the HTTP entry point owns its startup and shutdown via `SessionHttp`.
- **`apps/web`**: Svelte 5 components compiled by Vite with local Tailwind CSS. `App.svelte` owns hash navigation; `routes.ts` and `RouteOutlet.svelte` map the four explicit routes (`#/workspace`, `#/settings`, `#/persona`, `#/sources`), plus the provider settings subroute `#/providers`. One `lib/layout/AppShell.svelte` owns the common sidebar frame and persistent global Ask. Generic typed controls live in `lib/ui`; feature components live in `features/workspace`, `settings`, `persona`, and `sources`; General shows read-only workspace configuration plus appearance preferences, and Sources marks connections unavailable. Provider sign-in, model browsing and disconnect happen inline in expandable provider rows. Settings and persona editing use an in-page `InlinePanel` (initial focus, Escape, focus return) instead of modal dialogs; item edits use its `editor` variant inside the item's own row (prompt text, files, reference settings, skill folders) and the persona name/description is edited in the page header. Chat info is a `Popover` on the chat header; the generic `Modal` primitive remains available but unused by first-party routes. The reply composer appears only while a chat is open; when one is, the global Ask recedes visually until focused or holding a draft. A small context-owned session client adapter owns transport, selected session and drafts. There is no router dependency or global state framework; browser storage holds only the selected UUID and the appearance preference.

**Themes.** `lib/theme/themes.css` defines each theme as a neutral RGB ramp (`--n-0` page surface … `--n-950` strongest text), a sidebar surface and an accent; every semantic token (`--background`, `--muted-foreground`, `--interactive`, status tints, shadows) derives from those, and Tailwind's `zinc`/`gray`/`neutral`/`white` utilities map onto the same ramp so existing components follow the active theme. `lib/theme/themes.ts` names the themes (Daylight, Paper, Mist; Midnight, Ocean, Ember; plus System), font stacks and text sizes; `appearance.svelte.ts` stores the browser-local choice under `pispark.appearance` and applies `data-theme`, `--font-sans`, `--font-reading` and the root font size before the first render. Fonts are system stacks; none are bundled.

In development, Vite serves the UI on loopback port 5173 and proxies `/api` to port 3000. In production, the compiled Node entry serves `apps/web/dist` relative to its own module location, not the working directory.

### HTTP surface

| Route | Behavior |
| --- | --- |
| `GET /api/health` | `200` with `{ "status": "ok", "service": "pispark" }` |
| Other methods on `/api/health` | `405`, with `Allow: GET` |
| `/api/catalog`, `/api/sessions`, `/api/commands`, `/api/receipts/*`, session `/live`, `/items` and parts | [Bounded session protocol](session-protocol.md), strict local Host/Origin validation |
| `/api/providers` and `/api/providers/*` | Native provider catalog, default/refresh/logout and owner-capability sign-in bridge; same local security guard |
| `/api/personas` and `/api/personas/*` | [Layered persona management](personas.md): list, read the resolved layers, create, revision-checked saves and item files; same guard |
| Unknown `/api` routes | JSON `404`, never frontend HTML |
| `GET` / `HEAD` `/` | Built HTML entry, or `404` if not built |
| `GET` / `HEAD` `/favicon.svg`, `/assets/*` | Existing permitted build assets, or `404` |
| Other eligible frontend GET paths | Built SPA entry, or `404` when unavailable |

Static paths are decoded once, reject dot/hidden segments, nulls and backslashes, and must remain within the build root after resolving symlinks. Supported asset types are explicit. Builds are trusted local files, not user uploads. Requests are uncached in this starter. This intentionally small server is not a general-purpose static hosting service.

The workspace uses real sessions and native messages/tool results through typed view state, not fixture conversations. Ask chooses a working folder (any existing folder on the backend host), a persona (Default when not chosen) and a model; there is no configuration file. Style remains unavailable. The status indicator reports actual client connectivity, not provider health. Providers & models is backed by native Pi auth/catalog/default persistence. Personas are layered folders under the data folder with real persistence; General saves browser-local appearance preferences and links to the Default persona. Sources shows that connections are unavailable. Ask and independent session drafts survive route changes in memory; reload discards drafts and reconnects to the selected UUID.

The conversation is one continuous list. `chat-turns.ts` groups the chat's items (history by cursor plus the live tail) into **turns**: your message, then the response as ordered **segments**: thinking, Markdown text, an **activity** (consecutive tool calls merged into one quiet line that opens into what each call did, results attached to their call), an extension's custom message or entry, a summary, an extension notice at the place it happened, or a note that the run was stopped. `ResponseTurn.svelte` draws a turn by looking up the view registered for each segment kind (`views.svelte.ts`; PiSpark's own views register through the same calls an extension will use, see [extensions](extensions.md#views-how-the-conversation-is-drawn-and-how-to-replace-a-part-of-it)). Markdown streams through `markdownBlocks` (`lib/markdown.ts`): finished top-level blocks render once and are cached, only the last block is repaired for half-written code spans, emphasis or links and re-rendered, and the same sanitizer allow-list applies. Scrolling up to the top reads older items in above and restores the position by hand (browser scroll anchoring is off); new output follows only while the view is at the bottom, and "Jump to latest" returns to it.

Hash routes need no server SPA fallback. Material Symbols is bundled locally under `/assets/` with its Apache 2.0 license and provenance in `apps/web/src/assets/fonts/`; no runtime CDN is used. Its `Symbol` wrapper is kept for future use; current screens use the inline SVG icons in `lib/ui/icons.ts`.

The entry point binds only literal loopback, logs its listening address and handles SIGINT/SIGTERM by closing observers and draining the runtime, allowing up to five seconds before closing remaining HTTP connections. Cooperative runtime cleanup retains ownership until it actually finishes. Windows process managers may force-terminate rather than deliver POSIX signals.

## Internal runtime foundation

The [session runtime](session-runtime.md) owns the data folder (`PISPARK_HOME`, default `~/.pispark`), concurrent native AgentSessions, bounded pull-based live observation (items by cursor plus operations on the in-flight tail), cancellation, reload and graceful unload. Pi owns tools/model execution, native extension lifecycle and canonical JSONL context. Each chat folder holds a small `chat.json` and Pi's transcript; there is no parallel transcript database. Native extension loading is exact-path, with no ambient project/home resources or terminal Pi storage.

Every hosted session loads the ordinary built-in PiSpark integration extension; its first capability is a session-bound native title tool, not a public RPC framework. See [capability scope and lifetime](session-runtime.md#built-in-pispark-session-integration).

Real-SDK tests use a deterministic local provider, including two simultaneous sessions and killed-process recovery without tool replay. This is not external paid-provider verification. The current same-process policy admits trusted local code only, not sandboxed third-party execution. Compatibility and recovery limits are documented with the runtime API.

## Persona and observability foundation

Concrete modules under `src/personas` own the strict `persona.json` format, persona and chat-layer folders, and the single resolution rule (Default → flattened parents → persona → chat layer; later layers win). The resolved setup feeds Pi's own ResourceLoader, settings and tool list; SessionManager remains the sole canonical transcript owner. Chats read personas live and compare a setup fingerprint to flag changes. Feature components in `features/persona` compose generic `lib/ui` controls; controls own appearance and keyboard behavior, never domain requests. `src/logger.ts` projects an allowlist into a serialized bounded sink, without credential/content/native-cause serialization. See [personas](personas.md).

`src/extensions` holds PiSpark's side of Pi extensions: the built-in title extension, the per-chat `ExtensionUIContext` (Pi's `rpc` mode: questions, notices, statuses, widgets, editor text), the role theme and terminal-text-to-spans conversion, and running extensions' own renderers without a terminal. The web draws that state around the reply box and in the conversation. See [extensions](extensions.md).

## Next phase: follow the vision, then propose the smallest design

[VISION.md §11](../VISION.md#11-direction-for-the-next-development-phase) governs the next phase: inspect Pi's current SDK and extension APIs, identify what PiSpark genuinely needs to own, propose the smallest coherent backend design, surface unresolved decisions, and obtain approval before substantial implementation.

The existing fixtures are UI examples—not a persona schema, native Pi event model, resource format, or transport contract. Do not derive a competing agent framework from them. Pi remains responsible for agent execution and its native lifecycle; PiSpark hosts independent concurrent sessions and clients without inheriting terminal configuration implicitly.

[Web-native Pi extensions](../VISION.md#7-web-native-pi-extensions) must inform foundational decisions. Ordinary Pi extensions may own Svelte components and domain-specific interactions; PiSpark supplies placement, lifecycle, and communication hosting. Conceptual `host.call()` / `host.on()` semantics do not establish a shipped API, transport choice, mandatory manifest, or separate extension ecosystem. The first-party component library is not a limit on extension presentation. Third-party code loading remains a trust decision requiring explicit design.

Worker isolation, further persona resource types and extension UI hosting remain unimplemented. The initial [HTTP/SSE protocol](session-protocol.md) is implemented without freezing a future extension communication API. Keep proposals distinct from implementation facts, and return to VISION.md when evaluating these choices.
