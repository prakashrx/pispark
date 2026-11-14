# Architecture

**Product direction: [VISION.md](../VISION.md).** This page describes what is built. Judge changes against the vision, especially its ownership boundaries: Pi runs the agent, PiSpark hosts the experience, extensions make it their own.

## The parts

Three npm workspaces, with no shared package or framework layer:

| Workspace | What it is |
| --- | --- |
| `apps/server` | Node's own HTTP server in TypeScript. It hosts the sessions (Pi SDK sessions, pinned at 1.5.0), agents, providers, schedules and background work, and serves the built web app. `src/index.ts` wires it and owns listening and shutdown. |
| `apps/web` | Svelte 5, built with Vite and Tailwind. The browser app: sessions, agents, settings. |
| `apps/launcher` | The installed `pispark` program. It runs the server as its child, restarts it after a crash, updates it and rolls back a version that doesn't start ([install](install.md)). |

In development, Vite serves the web on port 5173 and passes `/api` to the server on port 3000. In production the server serves `apps/web/dist` itself, found relative to its own files, not the working directory.

### Three zones in the server

`apps/server/src` is three folders with one direction of imports. `apps/server/test/boundaries.test.ts` fails when an import crosses the wrong way.

| Zone | What it is | May import |
| --- | --- | --- |
| `contract/` | The types and pure functions a client may use: the session, agent, provider and host protocols, the live document's operations, session title rules, the Svelte modules shared with extension components | nothing else |
| `core/` | The hosting layer: `runtime/` (sessions, run slots, storage, providers, schedules, processes), `agents/`, `extensions/`, the data folder, the launcher link and the logger. No HTTP, no browser, nothing about how a client draws a session | `contract` |
| `http/` | The local server for the workspace: routes, static files, the host's configuration and the names of the places the workspace draws for extensions | `core`, `contract` |

`index.ts` wires them. `apps/web` and `apps/launcher` import the server only through `contract/`.

**What belongs in the core:** what an app with no conversation on screen would still need (sessions, agents, run slots, calls). How a conversation looks (turn grouping, tool wording, which `session.*` places are drawn, Ask) belongs to the workspace. The core knows "session", "agent", "extension", "point", "view" and "call", and no tool name except Pi's own.

**The launcher link.** The launcher and the server talk over Node's parent–child channel (`contract/host-protocol.ts`; the server's side is `core/host-link.ts`). `GET`/`POST /api/host` (`http/host-http.ts`) passes on its state and the browser's requests. A server started any other way is not managed and has no updates.

## The server

The [session runtime](session-runtime.md) owns the data folder (`PISPARK_HOME`, default `~/.pispark`) and the sessions in it: concurrent Pi sessions, live observation (items by cursor plus operations on the unsaved tail), cancellation, reload, loading and unloading, run slots, schedules, routines, child sessions and background processes. Pi owns the tools, model calls, extension lifecycle and the transcript. Each session folder holds a small `session.json` and Pi's transcript; there is no second transcript store. Extensions load from exact paths only: no terminal Pi storage, no resources found by looking around. The one thing read from a working folder is a [project agent](agents.md#project-agents)'s `AGENTS.md`, through Pi's own loader.

Every session also loads PiSpark's built-in extension, an ordinary Pi extension with PiSpark's tools: naming the session, schedules, child sessions, background processes ([details](session-runtime.md#built-in-pispark-session-integration)).

`src/core/agents` owns the strict `agent.json` format, agent folders and session layers, and the one resolution rule (Default → parents, flattened → agent → session layer; later layers win). The result feeds Pi's own resource loader, settings and tool list ([agents](agents.md)).

`src/core/extensions` holds PiSpark's side of Pi extensions: the UI context Pi's `rpc` mode expects (questions, notices, statuses, widgets, editor text), terminal text turned into styled spans, extensions' own renderers without a terminal, and compiling an extension's Svelte components for the browser ([extensions](extensions.md)).

`src/core/logger.ts` writes only an allow-list of operational fields, never credentials or content.

The server binds only to loopback and checks every request's Host and Origin ([security](../SECURITY.md)). On SIGINT/SIGTERM, or a stop from the launcher, it closes observers and drains the sessions, waiting up to five seconds before closing the remaining connections.

### HTTP

| Route | What |
| --- | --- |
| `GET /api/health` | `200 {"status":"ok","service":"pispark"}`; other methods `405` |
| `/api/catalog`, `/api/sessions/*`, `/api/commands`, `/api/receipts/*`, `/api/settings`, `/api/schedules/*`, `/api/routines/*`, `/api/processes`, `/api/views/*`, `/api/host` | The [session protocol](session-protocol.md) |
| `/api/providers/*` | Providers & models: catalog, default, refresh, sign-in and sign-out ([protocol](session-protocol.md#providers--models-native-store-and-browser-bridge)) |
| `/api/agents/*` | [Agent management](agents.md#http) |
| Any other `/api` path | JSON `404`, never the web page |
| `/`, `/favicon.svg`, `/assets/*`, the PWA files | The built web app, or `404` when it isn't built |

Static paths are decoded once, refuse dot segments, hidden files, nulls and backslashes, and must stay inside the build folder after symlinks are resolved. Only known file types are served. The web uses hash routes, so the server needs no fallback for them.

## The web

`App.svelte` owns hash navigation; `routes.ts` names the screens: Sessions (`#/workspace`), General settings, Providers & models, Agents, Background (`#/schedules`), Sources and About. One `lib/layout/AppShell.svelte` is the frame every screen shares: the sidebar and the global Ask. There is no router dependency and no global state framework; browser storage holds only the selected session and the appearance choice.

- **`lib/ui`**: generic typed controls (`Selector`, `Toggle`, `Menu`, `Popover`, `InlinePanel`, …). They own appearance and keyboard behavior, never requests. Panels open in the page, not as modal dialogs.
- **`lib/theme`**: each theme is a neutral color ramp, a sidebar surface and an accent; every other color derives from those, and Tailwind's gray utilities map onto the same ramp. Fonts are system fonts; the icon font is bundled. Nothing loads from a CDN.
- **`features/workspace`**: the sessions. Each open session is a `Session` (`session.svelte.ts`: its state, its items as they stream, its draft, send, stop and answer), the counterpart of the server's `Session`. `SessionClient` is the app around them (the session list, which session is open, Ask), and `Transport` holds requests, commands and receipts. `SessionArea` shows the view the person chose: the conversation, or a view an extension offers; every view and extension component is given the `Session` and nothing else about sessions. `SessionHeader` and `SessionSidebar` are PiSpark's own and show around any view.
- **`features/agent`, `settings`, `schedules`, `background`, `sources`, `about`**: the other screens and panels. Sources says that connections aren't available yet.

**The conversation** is one continuous list. `session-turns.ts` groups a session's items into turns: your message, then the response as ordered segments (thinking, text, an activity line for consecutive tool calls, an extension's message, a summary, a notice, a stop). `ResponseTurn.svelte` draws each segment with the view registered for its kind (`views.svelte.ts`); PiSpark's own views register the same way an extension's do ([extensions](extensions.md#how-pispark-draws-the-conversation)). Markdown streams block by block: finished blocks render once, only the last is repaired and redrawn, with one sanitizer allow-list. Scrolling to the top reads older items in; new output is followed while the view is at the bottom, and "Jump to latest" returns there.

## Not built yet

Sources (finding and connecting agents and extensions), styles, connecting an agent's MCP servers, reaching PiSpark by name from other devices, isolating extension code, and extension places beyond a session. New backend work starts as [VISION.md §11](../VISION.md#11-direction-for-the-next-development-phase) says: look at what Pi already provides, propose the smallest design, agree on it, then build.
