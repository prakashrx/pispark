# PiSpark

**A little spark. Your own space.**

An open-source foundation for a customizable agent workspace built with Node, Svelte, and eventually the [Pi Agent SDK](https://github.com/earendil-works/pi-mono).

## Status: starter, not an agent yet

Working today: a responsive dark workspace, collapsible sidebar, accessible local-only demo composer, real backend health indicator, and a small HTTP server that serves the production UI.

Not implemented: Pi integration, model calls, personas, sessions, persistence, authentication, or messaging interfaces. The composer never sends your draft or generates an answer. Persona/model controls are clearly disabled placeholders.

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
apps/web/       Svelte 5 + Vite UI and component smoke tests
docs/          Architecture, development, and product direction
scripts/       Production HTTP smoke check
.github/       Cross-platform CI and pull request template
```

- [Architecture](docs/architecture.md) — implemented boundaries and next integration seam
- [Development](docs/development.md) — scripts, configuration, testing, dependency notes
- [Product direction](docs/product-direction.md) — the vision, explicitly not a feature list
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT license](LICENSE)

Source and discussion: [prakashrx/pispark](https://github.com/prakashrx/pispark).
