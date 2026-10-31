# Development

## Toolchain

Use Node **22 (22.17.1+), 24, or 26+** and npm **10+**. Node 23 and 25 are excluded by the test toolchain. The lockfile records the dependency graph. Vite 6 is intentional: newer Vite majors can require a newer Node 22 patch. Vitest 5 supports Node `^22.12.0 || ^24.0.0 || >=26.0.0` and Vite 6.4+, so it works on the starter baseline. Review engines and advisories before changing versions.

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
| `npm test` | `make test` | Backend HTTP tests and jsdom UI smoke tests |
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
- `apps/web/src/App.test.ts`: rendered starter, collapsible sidebar, explicitly local-only demo, disabled placeholders, health fetch, failure/retry, and invalid responses. These are jsdom tests, **not** browser layout or assistive-technology certification.
- `scripts/smoke.mjs`: spawns the compiled server on an ephemeral port and checks real production HTTP responses. Run after building; it stops its own child process.

For a manual UI pass, test a narrow viewport, Tab/Shift+Tab focus, Enter/Space activation, the skip link, sidebar toggle, and textarea-to-preview flow. Stop/restart the backend to verify the indicator and refresh control. Drafts intentionally disappear on page reload.

## Dependency findings

The starter installation reports three **low** development-tool audit entries through `deepmerge` and the Svelte Vite plugin/inspector (GHSA-gcqx-w48m-w2h4). At initial verification, npm reported no upstream fix. These tools merge trusted local build configuration, not public API input. Keep the toolchain local, review updates, and do not use `npm audit fix --force` blindly. `npm audit --omit=dev` is clean at initial verification.

jsdom's transitive `whatwg-encoding` package also emits a deprecation warning. It is used only for tests. Full audit output and engine compatibility should be rechecked on dependency changes; warnings are not evidence of failed typechecks.
