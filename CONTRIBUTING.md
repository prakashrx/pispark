# Contributing

PiSpark connects its shared web shell to backend-owned Pi sessions through a bounded local HTTP/SSE protocol. Persona/source management and extension-owned browser rendering remain deferred, not working runtime features. Small, readable changes with clear boundaries are welcome.

**Read [VISION.md](VISION.md) before contributing. It is the authoritative product direction, not a list of shipped capabilities.** Follow [AGENTS.md](AGENTS.md) for working rules. Pi runs the agent; PiSpark hosts the experience; extensions make it their own.

1. For product or architectural changes, discuss the scope in a [GitHub issue](https://github.com/prakashrx/pispark/issues) first. Explain alignment with the relevant vision sections, what Pi already provides, what PiSpark must own, and any unresolved decisions. Obtain agreement before substantial implementation.
2. Install a supported Node version (`^22.19.0 || ^24.0.0 || >=26.0.0`) and npm 10+, then run `npm ci` and `npm run dev`. Startup is unconfigured by default. Read [operator configuration and protocol](docs/session-protocol.md) before enabling execution: configuration modules and admitted extensions are trusted host code, session endpoints enforce loopback Host/Origin checks, and external providers require a patched Node-bundled undici (no waiver). Do not use terminal credentials implicitly or run paid calls as tests.
3. Keep runtime logic in `apps/server`, web UI in `apps/web`, and durable explanations in `docs/`. Prefer a small concrete component over a speculative abstraction.
4. Add tests for changed behavior; keep demo interactions explicitly labeled. Do not imply unimplemented agent features work.
5. Before opening a PR, run `npm run check`, `npm test`, `npm run build`, and `npm run smoke`. For UI changes, also run the real-browser development and production-asset suites described in [development](docs/development.md). Tests use real Pi sessions with a deterministic local provider, not paid services. Update docs when commands or boundaries change.

Commit the root lockfile when dependencies change. Do not commit credentials, environment files, private work records, runtime metadata, or personal screenshots. Avoid machine-specific paths in public documentation.

See [development](docs/development.md) for platform notes. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public issue.
