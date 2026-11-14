# Security

PiSpark is a single-user workspace for one person on their own computer or server. It is not a hardened multi-user service.

## The trust model

- **No login, so loopback only.** PiSpark listens only on `127.0.0.1` (or `::1`) and refuses to start on any other address. It answers only requests addressed to `127.0.0.1` or `localhost`, and refuses cross-site browser requests, so other websites can't drive it. That protects against websites, not against other programs or users on the same machine.
- **Reach it remotely only through a tunnel.** Never forward its port, put it behind a public proxy or share it with anyone you don't trust. Use an SSH tunnel ([install](docs/install.md)).
- **Agents act with your rights.** An agent's tools run as your user, in the chat's folder but not confined to it. Nothing is sandboxed.
- **Extensions and personas are trusted code.** A Pi extension runs in the server process with your permissions, and its Svelte components run in the PiSpark page. Skills and instructions steer the agent. Add only ones you trust; loading only what a persona names is configuration, not isolation.
- **Provider sign-ins are stored unencrypted.** Pi keeps them in `<data folder>/providers/auth.json`. PiSpark doesn't encrypt them; protect the data folder and its backups. During sign-in a key passes through the browser's memory, never its storage. Signing out removes the stored credential, not grants at the provider or keys in your environment.
- **Terminal Pi stays separate.** PiSpark never reads `~/.pi` or terminal Pi's credentials.
- **PiSpark's own log entries** hold operational facts only: no prompts, file contents or credentials. What an extension or a background process prints is logged as it is.

## What PiSpark checks

- **Requests:** exact JSON fields, size and time limits on every request and stream, and static files only from the build folder ([protocol](docs/session-protocol.md)).
- **Node:** PiSpark refuses to start on a Node whose bundled `undici` has known security advisories ([the gate](docs/session-protocol.md#required-runtime-security-gate)). Releases bring a Node that passes.
- **Updates:** downloaded from this repository's GitHub Releases over HTTPS and checked against the release's `SHA256SUMS`. That catches damaged downloads, but not a compromised GitHub account: releases are not signed yet.
- **Dependencies:** known advisories and why they don't apply are listed in [development](docs/development.md#dependency-findings).

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/prakashrx/pispark/security/advisories/new). If it isn't available, open an issue asking for a private contact, **without details**. Never put secrets, private files or exploit details in a public issue.

The newest Stable release and `main` are maintained. There is no response-time or support guarantee.
