# PiSpark

**Quiet by default. Powerful when you reach for it.**

PiSpark is an open-source, self-hosted, web-native workspace being built on the [Pi Agent SDK](https://github.com/earendil-works/pi-mono).

**[Read VISION.md](VISION.md) — the authoritative product direction and architectural principles.** Pi runs the agent. PiSpark hosts the experience. Extensions make it their own. The intended experience includes backend-owned independent sessions, composable personas, and ordinary Pi extensions contributing their own Svelte interfaces—not a browser terminal or another agent framework. These are product goals; current capabilities are listed below.

## Status: local sessions and native provider settings

The shared shell, Ask, session sidebar and reply now connect to independently hosted Pi SDK sessions through bounded HTTP commands and streamed snapshots. Explicitly configured sessions support native tools/history, concurrent execution, cancellation, stop/unload and reconnect. No browser tab owns execution. Start unconfigured to explore the UI; Run remains unavailable until an operator supplies actual server-side workspace/model configuration.

See [setup, security gate and protocol](docs/session-protocol.md) and [runtime ownership](docs/session-runtime.md). External-provider activation requires a security-patched Node runtime; deterministic local tests prove actual SDK orchestration, not external auth/network compatibility. No external paid-provider validation or publication approval is claimed.

Providers & models now supports Pi-native sign-in, stored credential removal, catalog refresh, model selection and a durable default for new catalog-enabled sessions. Configured/available is not verified account or subscription entitlement. Pi manages credentials at an explicit PiSpark-owned path; host environment credentials may also apply. Secret inputs pass transiently through the browser bridge, not browser storage. File-backed credentials are not encrypted by PiSpark.

Persona/style execution, other settings saves, source connections/marketplace and extension Svelte hosting remain deferred. Those screens retain clearly marked local fixtures/drafts, not executable capabilities. Ask and per-session reply drafts survive route changes but reset on reload. Credentials persist server-side; the browser stores only the selected session UUID.

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
