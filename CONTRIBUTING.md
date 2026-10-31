# Contributing

PiSpark is an early scaffold. Small, readable changes with clear boundaries are welcome.

1. For product or architectural changes, discuss the scope in a [GitHub issue](https://github.com/prakashrx/pispark/issues) first.
2. Install Node 22.17.1+ and npm 10+, then run `npm ci` and `npm run dev`.
3. Keep runtime logic in `apps/server`, web UI in `apps/web`, and durable explanations in `docs/`. Prefer a small concrete component over a speculative abstraction.
4. Add tests for changed behavior; keep demo interactions explicitly labeled. Do not imply unimplemented agent features work.
5. Before opening a PR, run `npm run check`, `npm test`, `npm run build`, and `npm run smoke`. Update docs when commands or boundaries change.

Commit the root lockfile when dependencies change. Do not commit credentials, environment files, private work records, runtime metadata, or personal screenshots. Avoid machine-specific paths in public documentation.

See [development](docs/development.md) for platform notes. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public issue.
