# PiSpark

**Quiet by default. Powerful when you reach for it.**

PiSpark is an open-source, self-hosted, web-native workspace being built on the [Pi Agent SDK](https://github.com/earendil-works/pi-mono).

**[Read VISION.md](VISION.md) — the authoritative product direction and architectural principles.** Pi runs the agent. PiSpark hosts the experience. Extensions make it their own. The intended experience includes backend-owned independent sessions, composable personas, and ordinary Pi extensions contributing their own Svelte interfaces—not a browser terminal or another agent framework. These are product goals; current capabilities are listed below.

## Status: local sessions, personas and native provider settings

The shared shell, Ask, session sidebar and reply connect to independently hosted Pi SDK sessions through bounded HTTP commands and a streamed live document, with native tools/history, concurrent execution, cancellation, stop/unload, reload and reconnect. No browser tab owns execution. There is no configuration file: start the server, sign in under Providers & models, and ask. Data lives in `PISPARK_HOME` (default `~/.pispark`), created on first start.

See [setup, security gate and protocol](docs/session-protocol.md) and [runtime ownership](docs/session-runtime.md). External-provider activation requires a security-patched Node runtime; deterministic local tests prove actual SDK orchestration, not external auth/network compatibility. No external paid-provider validation or publication approval is claimed.

Providers & models now supports Pi-native sign-in, stored credential removal, catalog refresh, model selection and a durable default for new catalog-enabled sessions. Configured/available is not verified account or subscription entitlement. Pi manages credentials at an explicit PiSpark-owned path; host environment credentials may also apply. Secret inputs pass transiently through the browser bridge, not browser storage. File-backed credentials are not encrypted by PiSpark.

[Personas](docs/personas.md) are layered blueprints of a Pi session: a folder with `persona.json` plus instructions, skills, prompt templates (`/commands`) and extensions. Every persona builds on **Default** (which starts with Pi's built-in tools) and optionally on other personas; inherited items can be switched off or customized without changing the parent. Chats use personas live, flag changes and reload on request; editing a persona inside a chat gives that chat its own layer. A persona with a `folder` is a project persona: it always works in that folder and reads its `AGENTS.md`. A persona with a `home` view is an app: it is opened from the sidebar's Apps section and shows that view first. [Pi extensions](docs/extensions.md) run unchanged: their questions, notices, statuses, widgets and own renderers appear in the web, following the PiSpark theme. An extension can also place its own Svelte components in the chat with one event on Pi's bus (`pispark:view`), which terminal Pi ignores. Structured content-free operational logs are bounded and instance-owned.

Every hosted session loads an ordinary built-in PiSpark integration extension. Its first native tool, `pispark_set_title`, lets that session set its own validated, durable chat title during normal agent interaction. No separate naming request, history backfill, filesystem permission or terminal Pi change is involved. Chat info (the ⓘ button in the chat header) shows persona, model, working folder and start time—not runtime diagnostics. Every chat in the sidebar has an archive button (on hover or focus); archived chats wait in **Archived** at the end of the list, where they are restored or deleted for good. A chat can wake itself on a schedule. In Chat info → Schedules, or by asking the agent ("check again in 30 minutes", "every weekday at 9"), a prompt is sent to that chat at a time, once or repeating, even while the browser is closed. The agent's tool asks you first. Settings → Schedules lists them all and pauses everything that runs without you; each run is a turn in its chat, labelled as scheduled. Nobody opens or stops chats by hand: a chat loads when it is shown or sent to, unloads after 15 idle minutes, and prompts past the run limit (Settings → General) wait their turn.

Styles, other settings saves, source connections/marketplace and extension Svelte hosting remain deferred. General settings saves appearance preferences in this browser and links to the Default persona; Sources explains that connections are unavailable. Ask, reply and persona drafts survive route changes but reset on reload. Credentials persist server-side; the browser stores the selected session UUID and appearance preferences.

## Run locally

Requires **Node 22 (22.23.4+), Node 24, or Node 26+** and **npm 10+**. No terminal Pi installation, credentials, or environment file is needed. Startup also checks Node's bundled undici security version on every supported major; see the protocol guide.

```sh
npm ci
npm run dev
```

Open **<http://127.0.0.1:5173>**. Vite proxies `/api` to the backend on port 3000. Both servers bind to loopback by default. Stop with Ctrl+C.

```sh
npm run check
npm test
npm run build
npm run smoke
npm start
```

After building, `npm start` serves the UI and API together at **<http://127.0.0.1:3000>**. `npm run smoke` starts and stops its own production server on a free loopback port.

GNU Make wrappers are available (`make install`, `make dev`, `make check`, `make test`, `make build`, `make smoke`, `make start`). On Windows without Make, use the npm commands above; no Unix shell is required.

## Repository

```text
apps/server/    Node HTTP/session host, Pi runtime and backend tests
apps/web/       Svelte 5 + Vite + Tailwind UI, unit and browser tests
VISION.md      Authoritative product direction and architectural principles
docs/          Implemented architecture and development instructions
scripts/       Production HTTP smoke check
.github/       Cross-platform CI and pull request template
```

- [Architecture](docs/architecture.md) — implemented boundaries and next integration seam
- [Development](docs/development.md) — scripts, configuration, testing, dependency notes
- [Vision](VISION.md) — authoritative direction, not a shipped-feature list or implementation specification
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT license](LICENSE)

Source and discussion: [prakashrx/pispark](https://github.com/prakashrx/pispark).
