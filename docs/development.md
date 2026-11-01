# Development

## Toolchain

Use Node **22 (22.17.1+), 24, or 26+** and npm **10+**. Node 23 and 25 are excluded by the test toolchain. The lockfile records the dependency graph. Vite 6 is intentional: newer Vite majors can require a newer Node 22 patch. Vitest 5 supports Node `^22.12.0 || ^24.0.0 || >=26.0.0` and Vite 6.4+, so it works on the supported baseline. Review engines and advisories before changing versions.

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

Make is optional. All npm scripts work in Windows PowerShell/cmd as well as Unix shells. CI runs install, check, test, build, and HTTP smoke on Ubuntu and Windows using Node 22.17.1.

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

Vite's dev proxy is intentionally fixed to `http://127.0.0.1:3000`; use the default backend address in development, or update `apps/web/vite.config.ts` deliberately. Both dev ports fail clearly if occupied. The backend can run health-only before the frontend is built and prints instructions when the build is absent.

## Tests and boundaries

- `apps/server/test/server.test.ts`: health, method rules, API 404, static types/HEAD, missing build, raw and encoded traversal, hidden files, invalid encodings, and symlink/junction escape protection. Tests bind ephemeral loopback ports and clean up fixtures.
- `apps/web/src/App.test.ts`, `routes.test.ts`, and `lib/ui/Selector.test.ts`: fixture-only behavior, local edits, persistent/independent composers, route handling, sidebar and selector keyboard/focus behavior. These are jsdom tests, **not** browser layout or assistive-technology certification.
- `apps/web/tests/`: real-browser checks for all four routes, equal shared-shell geometry, draft/selection persistence, history, keyboard focus, mobile/tablet reflow, source-draft validation/modal focus, local fonts, and no external requests. They use only checked-in UI/fixtures, not private design originals.
- `scripts/smoke.mjs`: spawns the compiled server on an ephemeral port and checks real production HTTP responses. Run after building; it stops its own child process.

### Optional browser checks

Install Playwright's Chromium once after `npm ci`, then run the browser suite:

```sh
npx playwright install chromium
npm run test:browser -w @pispark/web
```

On Linux, `npx playwright install --with-deps chromium` also installs browser system dependencies (may require administrator privileges). The default uses Playwright Chromium, not a machine-specific executable. To use an already installed supported browser, set `PISPARK_BROWSER_CHANNEL=msedge` or `chrome` in your shell. Tests start Vite on loopback port 4180, reusing a local server outside CI. `PISPARK_TEST_URL` overrides that address/port; choose an unused port (for example `http://127.0.0.1:4182`) when an older preview is running, to avoid testing stale transforms. Reports and screenshots stay in ignored `apps/web/test-results/` and `playwright-report/`; `PISPARK_EVIDENCE_DIR` optionally redirects screenshots.

To run the same checks against the actual built Node server, build first and set `PISPARK_TEST_PRODUCTION=1`. This starts and stops an owned server on port 4181 and never reuses the development server:

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

CI currently runs the core checks and HTTP smoke, not the optional browser suite. For a manual UI pass, test narrow layouts, Tab/Shift+Tab focus, Enter/Space activation, Escape dismissal/focus return, the skip link, sidebar toggle, independent Ask/reply drafts, conditional Style selection, and source modal. The status dot is a fixture, not a network indicator. Drafts intentionally disappear on reload.

## Dependency findings

The installation reports three **low** development-tool audit entries through `deepmerge` and the Svelte Vite plugin/inspector (GHSA-gcqx-w48m-w2h4). At frontend publication verification, npm reported no upstream fix. These tools merge trusted local build configuration, not public API input. Keep the toolchain local, review updates, and do not use `npm audit fix --force` blindly. `npm audit --omit=dev` is clean at frontend publication verification.

jsdom's transitive `whatwg-encoding` package also emits a deprecation warning. It is used only for tests. Full audit output and engine compatibility should be rechecked on dependency changes; warnings are not evidence of failed typechecks.
