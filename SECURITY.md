# Security

PiSpark is a local-development starter, not a hardened hosted service. There is no authentication or agent execution. Do not expose it directly to an untrusted network. The server and Vite bind to loopback by default; changing `HOST` can expose the production server.

The HTTP API currently provides health only. Static serving is limited to the built entry, favicon, and known asset types, with raw-path validation and canonical-path containment. Only trusted build artifacts should be placed in the frontend output directory; it is not an upload area.

## Reporting

Use [GitHub's private vulnerability reporting](https://github.com/prakashrx/pispark/security/advisories/new) if enabled. If unavailable, open an issue asking for a private contact **without disclosing vulnerability details**. Do not include secrets, private files, or exploit details in public issues.

Only the current `main` branch is maintained during this pre-release stage. There is no response-time or production-support guarantee.

## Dependencies and future integration

Run `npm audit` and review findings, including development tools. Known starter toolchain limitations are recorded in [development](docs/development.md). Keep dev servers local and never run untrusted project configuration.

Before adding the Pi SDK, design explicit resource loading, credential handling, tool permissions, workspace boundaries, and session isolation. Do not inherit terminal-Pi configuration or credentials implicitly.
