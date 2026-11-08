# Development

Read [VISION.md](../VISION.md) and [AGENTS.md](../AGENTS.md) before planning changes. The vision governs product/architecture; this document covers the current toolchain and commands, not a separate roadmap. Backend implementation starts with SDK/extension API investigation and an approved minimal design, as required by VISION.md §11.

## Toolchain

Use Node **22 (22.23.4+), 24, or 26+** and npm **10+**. Node 23 and 25 are excluded by the test toolchain. The lockfile records the dependency graph. Vite 6 is intentional: newer Vite majors can require a newer Node 22 patch. Vitest 5 supports Node `^22.12.0 || ^24.0.0 || >=26.0.0` and Vite 6.4+, so it works on the supported baseline. Review engines and advisories before changing versions.

```sh
npm ci
npm run dev
```

The root dev command starts both workspaces and stops the other when either exits. Alternatively run `npm run dev -w @pispark/server` and `npm run dev -w @pispark/web` in separate terminals. Open the Vite URL, not the backend URL, for hot reload.

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

Make is optional. All npm scripts work in Windows PowerShell/cmd as well as Unix shells. CI runs install, check, test, build, HTTP smoke and the production Chromium suite on Ubuntu and Windows using Node22.23.4. The pinned SDK requires Node22.19.0+, but PiSpark startup also requires patched bundled undici on every supported major. SDK-compatible patches are not necessarily supported hosts.

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

See [session configuration/protocol](session-protocol.md) for `PISPARK_CONFIG`, exact development origins, loopback-only binding and the hard Node-bundled transport security gate. The workspace/resource configuration catalog defaults empty. Native provider catalog/status is available on supported hosts; no fixture model is activated and terminal Pi files are not loaded. Host process environment/cloud auth semantics are intentionally native.

## Tests and boundaries

- `apps/server/test/session-runtime.test.ts`: real Pi SDK1.4.0 sessions with a deterministic local provider, native extension lifecycle, concurrency/cancel/queue policy, explicit resource/auth isolation, child-process interruption and native history recovery, bounded observers and storage/cleanup failures. No external model calls or terminal Pi setup required.
- `apps/server/test/session-http.test.ts`: real SDK over HTTP/SSE, command receipts/expiry, reconnect, cancellation, bounded histories/token streams/slow writes, security/admission and patched-transport version branches.
- `apps/server/test/provider-settings.test.ts` and `provider-http.test.ts`: native file-backed persistence/login/logout/OAuth refresh across runtimes, defaults and independent sessions, empty prompts, callback/cancel races, sync failures, shutdown drain, safe configuration/cache failure admission and child-only environment resolution. Temporary deterministic fixtures; no operator credentials/paid calls.
- `apps/server/test/personas.test.ts`, `persona-boundaries.test.ts`, `persona-sessions.test.ts`, `persona-http.test.ts` and `logger.test.ts`: strict schema/root/revision/atomic writes, deterministic inheritance, graph/file budgets, staged-copy failures, actual native support-file reading, source-independent recovery, dispatch integrity, unchanged initial/queued skill semantics and bounded safe logging. Component/state tests under `features/persona` cover ordering, read-only fields, dirty/late-save/late-read/409 and file drafts; browser tests exercise real management and native sessions.
- `apps/server/test/pispark-integration.test.ts`: actual native title-tool calls, every-session loading, restrictive tool policy, session scope, durable observer updates/reopen, cancellation/stale ownership, collision/storage failures and log privacy; deterministic local execution only.
- `apps/server/test/server.test.ts`: health, method rules, API 404, static types/HEAD, missing build, raw and encoded traversal, hidden files, invalid encodings, and symlink/junction escape protection. Tests bind ephemeral loopback ports and clean up fixtures.
- `apps/web/src/App.test.ts`, `routes.test.ts`, and `lib/ui/Selector.test.ts`: truthful unconfigured state, local deferred edits, persistent/independent composers, route handling, sidebar and selector keyboard/focus behavior. These are jsdom tests, **not** browser layout or assistive-technology certification.
- `apps/web/tests/`: real-browser checks for all four routes, equal shared-shell geometry, draft/selection persistence, history, keyboard focus, mobile/tablet reflow, persona collection/create/editor views without a tab strip, separate file drafts, stale preview and revision reconciliation, unknown tokens, native model radio groups/inline panel focus, local fonts, and no external requests. They use only checked-in UI/fixtures, not private design originals.
- `scripts/smoke.mjs`: spawns the compiled server on an ephemeral port and checks real production HTTP responses. Run after building; it stops its own child process.

### Optional browser checks

Install Playwright’s Chromium after `npm ci`, then build the assets used by the isolated browser hosts and run the suite:

```sh
npx playwright install chromium
npm run build
npm run test:browser -w @pispark/web
```

On Linux, `npx playwright install --with-deps chromium` also installs browser system dependencies (may require administrator privileges). The default uses Playwright Chromium, not a machine-specific executable. To use an already installed supported browser, set `PISPARK_BROWSER_CHANNEL=msedge` or `chrome` in your shell. Tests start their own Vite on loopback port4180 plus a test-only real SDK host on4182; no existing server is reused. `PISPARK_TEST_URL` overrides that address/port; choose an unused port (for example `http://127.0.0.1:4190`) when an older preview is running, to avoid testing stale transforms. `PISPARK_TEST_API_PORT` overrides the development API port. Runtime HOME/USERPROFILE and test results default to a private temporary directory, not the checkout. Set `PISPARK_TEST_STATE_ROOT` to an external evidence root for durable results, and `PISPARK_EVIDENCE_DIR` to optionally redirect shared-shell screenshots. Do not put operational evidence/auth/history in the repository.

To exercise production assets and the actual HTTP/session host, build first and set `PISPARK_TEST_PRODUCTION=1`. This starts/stops the test-only executable on4181 with the real SDK and deterministic provider; it is not the normal unconfigured production entry point and does not enable a fake provider there. Production `index.js` is separately covered by smoke:

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

CI installs Chromium and runs the production browser suite after the core checks and HTTP smoke. For a manual UI pass, test narrow layouts, Tab/Shift+Tab focus, Enter/Space activation, Escape dismissal/focus return, the skip link, sidebar toggle, independent Ask/reply drafts, real persona collection/create/editor and file-save/compose/validate/save/conflict states, session streaming/cancel/reconnect, concise Chat info and actual native title changes. Sources remains truthfully unavailable. The status dot reports client connectivity, not model-provider health, and adds "Offline" or "Connecting…" text when not connected. Drafts intentionally disappear on reload.

## Dependency findings

The pinned Pi SDK1.4.0 originally brings `undici@8.10.2`. A targeted root override replaces only that version with **8.12.2**, after compatible engine/API inspection and local HTTP/SDK tests. This addresses GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c, GHSA-4w7w-5xrc-9h26, GHSA-2m5v-pch6-74hx, GHSA-qrxm-fqhp-jwvm, GHSA-9fm3-97px-rjf6 and GHSA-55wc-3pg8-jfw6. Both SDK and OpenAI optional-peer paths deduplicate to8.12.2. Pi remains pinned1.4.0. This does **not** certify Node's separately bundled fetch/WebSocket implementation or external provider behavior.

Remaining production audit findings are **moderate**: `minimatch@10.2.6` and its Pi SDK parent (GHSA-g3hv-75wg-m249). The affected preprocessing requires attacker-controlled patterns with `optimizationLevel >= 2`; the host admits exact resources/models, not client glob patterns, and inspected SDK core call sites do not request that optimization level. Patched11.0.1 is a major-version change, not applied without compatibility review. This is a documented constrained-path mitigation, not blanket risk acceptance for extensions or future endpoints. Review before external-provider/remote enablement or publication.

Three **low** development-tool findings remain through `deepmerge` and the Svelte Vite plugin/inspector (GHSA-gcqx-w48m-w2h4). These tools merge trusted local build configuration, not public API input. Current full audit: 3low/2moderate/0high; production-only: 2moderate. Keep the toolchain local, recheck advisories on changes, and do not use `npm audit fix --force` blindly.

jsdom's transitive `whatwg-encoding` package also emits a deprecation warning. It is used only for tests. Full audit output and engine compatibility should be rechecked on dependency changes; warnings are not evidence of failed typechecks.

Validation processes should clear inherited `PISPARK_CONFIG` and credential variables and use an isolated test HOME/USERPROFILE/cloud configuration, not operator modules/state. Inject native-env fixtures in scoped child environments; do not swap process.env or cwd globally. Smoke/browser fixtures own temporary explicit paths/listeners. See the [provider protocol](session-protocol.md#providers--models-native-store-and-browser-bridge) for paths, catalog-enabled models and cancellation limits. Hosted CI and external provider compatibility are separate from local tests.
