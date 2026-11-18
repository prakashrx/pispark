# Development

Read [VISION.md](../VISION.md) and [AGENTS.md](../AGENTS.md) before planning changes. The vision governs product/architecture; this document covers the current toolchain and commands, not a separate roadmap. Backend implementation starts with SDK/extension API investigation and an approved minimal design, as required by VISION.md §11.

## Toolchain

Use Node **22 (22.23.4+), 24, or 26+** and npm **10+**. Node 23 and 25 are excluded by the test toolchain. The lockfile records the dependency graph. Vite 6 is intentional: newer Vite majors can require a newer Node 22 patch. Vitest 5 supports Node `^22.12.0 || ^24.0.0 || >=26.0.0` and Vite 6.4+, so it works on the supported baseline. Review engines and advisories before changing versions.

```sh
npm ci
npm run dev
```

The root dev command starts both workspaces and stops the other when either exits. Alternatively run `npm run dev -w @pispark/server` and `npm run dev -w @pispark/web` in separate terminals. Open the Vite URL, not the backend URL, for hot reload. The backend restarts when a file under `apps/server/src` is edited (`apps/server/dev.mjs`); a file that is only read, as Pi reads the built-in extension for each session, does not count.

## Commands

| npm | Make wrapper | Purpose |
| --- | --- | --- |
| `npm ci` | `make install` | Reproducible installation |
| `npm run dev` | `make dev` | Both development servers |
| `npm run check` | `make check` | Server TypeScript, Svelte diagnostics, Vite config types |
| `npm test` | `make test` | Backend HTTP tests and jsdom UI/route/selector tests |
| `npm run test:browser -w @pispark/web` | — | Desktop/mobile layout, keyboard and local interaction checks |
| `npm run build` | `make build` | Compile backend and bundle frontend |
| `npm run smoke` | `make smoke` | Check built entry, API, HTML, JS/CSS and favicon over HTTP |
| `npm start` | `make start` | Serve the production build |

Make is optional. All npm scripts work in Windows PowerShell/cmd as well as Unix shells. CI runs install, check, test, build, HTTP smoke and the production Chromium suite on Ubuntu and Windows using Node 22.23.4. The pinned SDK requires Node 22.19.0+, but PiSpark startup also requires patched bundled undici on every supported major. SDK-compatible patches are not necessarily supported hosts.

## Configuration

No environment file, credentials, or terminal Pi installation is required. The backend reads `HOST` (default `127.0.0.1`) and `PORT` (default `3000`). For a different production port:

```sh
# POSIX shell
PORT=3100 npm start
```

```powershell
# PowerShell
$env:PORT = '3100'
npm start
Remove-Item Env:PORT
```

Vite defaults to `http://127.0.0.1:3000`; `PISPARK_API_TARGET` overrides its proxy target. Both dev ports fail clearly if occupied. The backend serves health/catalog before the frontend is built and prints instructions when the build is absent.

See [setup and protocol](session-protocol.md) for `PISPARK_HOME`, exact development origins, loopback-only binding and the hard Node-bundled transport security gate. There is no configuration file: the data folder is created on first start with a Default agent. Set `PISPARK_HOME=~/.pispark-dev` in the ignored `.env` to keep development data separate. Terminal Pi files are never loaded. Host process environment/cloud auth semantics are intentionally native.

## Tests

Every test runs real Pi sessions against a deterministic local provider: no paid calls, credentials or terminal Pi setup.

| Where | What |
| --- | --- |
| `apps/server/test/` | The server, one file per area: sessions and their lifecycle, the HTTP protocol, providers, agents, extensions and their views, schedules, routines, child sessions, background processes, the launcher link, static files and the import boundaries between `contract/`, `core/` and `http/` |
| `apps/web/src/**/*.test.ts` | The web in jsdom: routes, the session client, controls and their keyboard behavior |
| `apps/web/tests/` | Real-browser checks of every screen: layout at narrow and wide widths, keyboard focus, sessions, agents, extensions, schedules and background work (below) |
| `apps/launcher/test/` | The installed launcher: release choice, checksums, install folders, version switches |
| `scripts/smoke.mjs` | The built server on a free port, over real HTTP |

### Optional browser checks

Install Playwright’s Chromium after `npm ci`, then build the assets used by the isolated browser hosts and run the suite:

```sh
npx playwright install chromium
npm run build
npm run test:browser -w @pispark/web
```

On Linux, `npx playwright install --with-deps chromium` also installs browser system dependencies (may require administrator privileges). The default uses Playwright Chromium, not a machine-specific executable. To use an already installed supported browser, set `PISPARK_BROWSER_CHANNEL=msedge` or `chrome` in your shell. Tests start their own Vite on loopback port 4180 plus a test-only real SDK host on 4182; no existing server is reused. `PISPARK_TEST_URL` overrides that address/port; choose an unused port (for example `http://127.0.0.1:4190`) when an older preview is running, to avoid testing stale transforms. `PISPARK_TEST_API_PORT` overrides the development API port. Runtime HOME/USERPROFILE and test results default to a private temporary directory, not the checkout. Set `PISPARK_TEST_STATE_ROOT` to an external evidence root for durable results, and `PISPARK_EVIDENCE_DIR` to optionally redirect shared-shell screenshots. Do not put operational evidence/auth/history in the repository.

To exercise production assets and the actual HTTP/session host, build first and set `PISPARK_TEST_PRODUCTION=1`. This starts/stops the test-only executable on 4181 with the real SDK and deterministic provider; it is not the normal unconfigured production entry point and does not enable a fake provider there. Production `index.js` is separately covered by smoke:

```sh
npm run build
# POSIX shell
PISPARK_TEST_PRODUCTION=1 npm run test:browser -w @pispark/web
```

```powershell
$env:PISPARK_TEST_PRODUCTION = '1'
npm run test:browser -w @pispark/web
Remove-Item Env:PISPARK_TEST_PRODUCTION
```

CI installs Chromium and runs the production browser suite after the core checks and HTTP smoke. For a manual UI pass, test the three sizes (phone, tablet, desktop), Tab/Shift+Tab focus, Enter/Space activation, Escape dismissal/focus return, the skip link, hiding the sidebar and the tablet drawer, independent New session/reply drafts, real agent collection/create/editor and file-save/compose/validate/save/conflict states, session streaming/cancel/reconnect, Details beside the conversation (column, overlay on a portrait tablet, its own screen on a phone; Back, Expand, Escape), archiving with its Undo toast (a long press on a phone row), the nudge when another session needs you, the "Can’t reach PiSpark" banner when the server stops, and actual native title changes. The status dot reports client connectivity, not model-provider health, and adds "Offline" or "Connecting…" text when not connected. Drafts intentionally disappear on reload.

## Dependency findings

The pinned Pi SDK 1.5.2 brings `undici@8.12.3`, which already includes the fixes the earlier root override supplied; no override is needed. Both SDK and OpenAI optional-peer paths deduplicate to 8.12.3. This does **not** certify Node's separately bundled fetch/WebSocket implementation or external provider behavior.

Remaining production audit findings are **moderate**: `minimatch@10.2.6` and its Pi SDK parent (GHSA-g3hv-75wg-m249). The affected preprocessing requires attacker-controlled patterns with `optimizationLevel >= 2`; the host admits exact resources/models, not client glob patterns, and inspected SDK core call sites do not request that optimization level. Patched 11.0.1 is a major-version change, not applied without compatibility review. This is a documented constrained-path mitigation, not blanket risk acceptance for extensions or future endpoints. Review before external-provider/remote enablement or publication.

Three **low** development-tool findings remain through `deepmerge` and the Svelte Vite plugin/inspector (GHSA-gcqx-w48m-w2h4). These tools merge trusted local build configuration, not public API input. Current full audit: 3 low/2 moderate/0 high; production-only: 2 moderate. Keep the toolchain local, recheck advisories on changes, and do not use `npm audit fix --force` blindly.

jsdom's transitive `whatwg-encoding` package also emits a deprecation warning. It is used only for tests. Full audit output and engine compatibility should be rechecked on dependency changes; warnings are not evidence of failed typechecks.

Validation processes should clear inherited `PISPARK_HOME` and credential variables and use an isolated test HOME/USERPROFILE/cloud configuration, not operator modules/state. Inject native-env fixtures in scoped child environments; do not swap process.env or cwd globally. Smoke/browser fixtures own temporary explicit paths/listeners. See the [provider protocol](session-protocol.md#providers--models-native-store-and-browser-bridge) for paths, catalog-enabled models and cancellation limits. Hosted CI and external provider compatibility are separate from local tests.
