# PiSpark

**A little spark. Your own space.**

An open-source foundation for a customizable agent workspace built with Node, Svelte, and eventually the [Pi Agent SDK](https://github.com/earendil-works/pi-mono).

## Status: approved frontend, not an agent yet

Working today: a responsive workspace/conversation, general settings, developer persona, and sources UI. All four routes share a collapsible sidebar and persistent Ask composer with local folder/persona/style/model selection. Keyboard navigation, local draft editing, and a source-draft modal work without a backend connection. A small HTTP server serves the production UI and a health endpoint.

The conversation, sessions, source statuses, version badge, and status dot are fixtures, not live activity or a backend health measurement. Drafts stay in memory and reset on reload; Run, backend saves, sync, and other unavailable operations do not execute. Pi integration, model calls, real personas/sessions, filesystem resolution, persistence, authentication, and messaging remain unimplemented. No credentials are needed or sent.

## Run locally

Requires **Node 22 (22.17.1+), Node 24, or Node 26+** and **npm 10+**. No Pi installation, credentials, or environment file is needed.

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
apps/server/    Node + TypeScript HTTP server and backend tests
apps/web/       Svelte 5 + Vite + Tailwind UI, unit and browser tests
docs/          Architecture, development, and product direction
scripts/       Production HTTP smoke check
.github/       Cross-platform CI and pull request template
```

- [Architecture](docs/architecture.md) — implemented boundaries and next integration seam
- [Development](docs/development.md) — scripts, configuration, testing, dependency notes
- [Product direction](docs/product-direction.md) — the vision, explicitly not a feature list
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT license](LICENSE)

Source and discussion: [prakashrx/pispark](https://github.com/prakashrx/pispark).
