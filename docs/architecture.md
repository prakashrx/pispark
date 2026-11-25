# Architecture

**Product direction: [VISION.md](../VISION.md).** This page describes what is built. Judge changes against the vision, especially its ownership boundaries: Pi runs the agent, PiSpark hosts the experience, extensions make it their own.

## The parts

Three npm workspaces, with no shared package or framework layer:

| Workspace | What it is |
| --- | --- |
| `apps/server` | Node's own HTTP server in TypeScript. It hosts the sessions (Pi SDK sessions, pinned at 1.5.2), agents, providers, schedules and background work, and serves the built web app. `src/index.ts` wires it and owns listening and shutdown. |
| `apps/web` | Svelte 5, built with Vite and Tailwind. The browser app: sessions, agents, settings. |
| `apps/launcher` | The installed `pispark` program. It runs the server as its child, restarts it after a crash, updates it and rolls back a version that doesn't start ([install](install.md)). |

In development, Vite serves the web on port 5173 and passes `/api` to the server on port 3000. In production the server serves `apps/web/dist` itself, found relative to its own files, not the working directory.

### Three zones in the server

`apps/server/src` is three folders with one direction of imports. `apps/server/test/boundaries.test.ts` fails when an import crosses the wrong way.

| Zone | What it is | May import |
| --- | --- | --- |
| `contract/` | The types and pure functions a client may use: the session, agent, provider and host protocols, the live document's operations, session title rules, the Svelte modules shared with extension components | nothing else |
| `core/` | The hosting layer: `runtime/` (sessions, run slots, storage, providers, schedules, processes, child sessions, holds; one small file each), `agents/`, `extensions/`, the data folder, the launcher link and the logger. No HTTP, no browser, nothing about how a client draws a session | `contract` |
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
| `/api/catalog`, `/api/sessions/*` (including attachments), `/api/commands`, `/api/receipts/*`, `/api/settings`, `/api/schedules/*`, `/api/routines/*`, `/api/processes`, `/api/views/*`, `/api/host` | The [session protocol](session-protocol.md) |
| `/api/providers/*` | Providers & models: catalog, default, refresh, sign-in and sign-out ([protocol](session-protocol.md#providers--models-native-store-and-browser-bridge)) |
| `/api/agents/*` | [Agent management](agents.md#http) |
| Any other `/api` path | JSON `404`, never the web page |
| `/`, `/favicon.svg`, `/assets/*`, the PWA files | The built web app, or `404` when it isn't built |

Static paths are decoded once, refuse dot segments, hidden files, nulls and backslashes, and must stay inside the build folder after symlinks are resolved. Only known file types are served. The web uses hash routes, so the server needs no fallback for them.

## The web

`routes.ts` names the screens and their addresses: New session (`#/new`, and home where there is room), a session (`#/s/<id>`, and on phones its Details `#/s/<id>/details[/<view>]`), Archived, Agents (`#/agents`, and an agent's page at `#/agents/<id>`: a tab per kind of resource, Settings, and its Agent Builder session beside them), Background and Settings (`#/settings/<section>`: Appearance, Providers & models, Remote access, About). `src/shell` is the frame every screen shares: `Shell` lays out the window for its size class (expanded: the sidebar beside the screen; medium: the sidebar as a drawer; compact: one screen at a time, the session list first), `Screen` gives each screen its top bar, banner, notices, main region and dock, `SidePanel` is the panel beside the screen (a column where the screen keeps 30 rem, 380 px unless its edge is dragged between 360 and 480, otherwise laid over it; Back, Expand and Close in its own bar), `Sidebar` is the app's navigation (sessions grouped and ordered by when they last did something), and `Banner` says what concerns the whole workspace, one cause one message (PiSpark updating, back on a newer version, out of reach and retrying, another failure). `attention.svelte.ts` holds what the app says in passing: a toast at the bottom for the result of what you did ("Archived … · Undo"), and a nudge at the top when another session starts needing you; `ToastHost` and `NudgeHost` show them over every screen. After an update the page reloads itself onto the new version when nothing is typed, and otherwise offers Reload. The session on screen is the one the address names. There is no router dependency and no global state framework; browser storage holds only the appearance choice, whether Details are open and the side panel's width. Dialogs that are forms (a schedule, a new agent) are full-screen sheets on phones, with Cancel, the title and the action in their bar.

- **`lib/ui`**: generic typed controls (`Selector`, `Toggle`, `Menu`, `Popover`, `Fold`, `Card` and `CardRow`, `Stepper`, `Modal`, `ConfirmDialog`, `InlinePanel`, `RichInput`, …). Settings sections are grids of cards; short tasks are dialogs (a sheet on a phone) that show a × only when they have no buttons of their own, and anything that can't be undone asks in `ConfirmDialog`. `RichInput` is text with tokens shown as chips in their place; the New session composer and replies use it for attachments (`features/workspace/attachments.svelte.ts`). They own appearance and keyboard behavior, never requests. On phones, popovers, menus and pickers open as sheets from the bottom.
- **`lib/theme`**: each theme is a neutral color ramp, a sidebar surface and an accent; every other color derives from those, and Tailwind's gray utilities map onto the same ramp. Inter is bundled (only the scripts a page uses load); icons are inline SVG. Nothing loads from a CDN.
- **`features/workspace`**: the sessions. Each open session is a `Session` (`session.svelte.ts`: its state, its items as they stream, its draft, send, stop and answer), the counterpart of the server's `Session`. `SessionClient` is the app around them (the session list, which session is open, the new session's draft and choices), and `Transport` holds requests, commands and receipts. `SessionArea` shows the view the person chose: the conversation, or a view an extension offers; every view and extension component is given the `Session` and nothing else about sessions. `SessionScreen` puts it on a screen: the top bar (`SessionBar`: state, view switch, Details, ⋯), the notice strip (`SessionNotices`), and the dock: the shelf (questions, queued), the reply box with its one Send / Stop / Cancel button, and the status line, whose model opens Details. The conversation scrolls in the screen's Main. Details (`SessionDetails`, `DetailsPanels`; open or closed in `details.svelte.ts`) sit in the side panel: foldable panels for the session's facts, schedules, background tasks, the sessions it started, its agent's routines and what keeps it running, and views opened from them (a schedule's form, routines, a process's output, the agent for this session) with Back to Details. Open by default where the panel fits beside the conversation, remembered once chosen; on phones they are screens.
- **`features/background`**: the Background screen, the one view across everything that runs without you. `background-groups.ts` groups it by owner (a session; an app with its sessions and routines; an agent's routines; an archived session's schedules) and filters it (Running, Scheduled, Failed); each card says who and where and opens it, and each row acts in place (stop, show output, switch) or opens the schedule's dialog. Pause all and Sessions working at once live here.
- **`features/agent`, `settings`, `schedules`, `remote`, `about`**: the other screens and panels. A schedule is added, changed, run and deleted in its dialog (`ScheduleDialog`), opened from a session's Details or from Background; a provider is added or managed in a dialog; a new agent is made in one.

**The conversation** is one continuous list. `session-turns.ts` groups a session's items into turns: your message, then the response as ordered segments (thinking, text, an activity line for consecutive tool calls, an extension's message, a summary, a notice, a stop). `ResponseTurn.svelte` draws each segment with the view registered for its kind (`views.svelte.ts`); PiSpark's own views register the same way an extension's do ([extensions](extensions.md#how-pispark-draws-the-conversation)). Markdown everywhere (replies, thinking, summaries, reports, your messages, `.md` files, the agent page's texts, and extension components through `host.Markdown`) is drawn by one module, `lib/markdown`; its `MarkdownEditor` adds a Preview / Edit switch, Edit being the whole text as written with its Markdown highlighted: GitHub Markdown through one sanitizer allow-list, with highlighted code, math and Mermaid diagrams loaded when first used, and extension renderers for other fenced languages (`markdown.fence:<language>`). While a text streams, only the text after its finished blocks is parsed; finished blocks are never redrawn, the open one is patched in place (so selection and focus survive), and updates are drawn at most once per frame. Scrolling to the top reads older items in; new output is followed while the view is at the bottom, and "Jump to latest" returns there.

## Not built yet

Sources (finding and connecting agents and extensions), styles, connecting an agent's MCP servers, reaching PiSpark by name from other devices, isolating extension code, and extension places beyond a session. New backend work starts as [VISION.md §11](../VISION.md#11-direction-for-the-next-development-phase) says: look at what Pi already provides, propose the smallest design, agree on it, then build.
