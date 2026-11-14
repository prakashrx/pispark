# Contributing

Small, readable changes with clear boundaries are welcome.

**Read [VISION.md](VISION.md) first.** It is the product direction, not a list of what is built. [AGENTS.md](AGENTS.md) has the working rules. Pi runs the agent; PiSpark hosts the experience; extensions make it their own.

1. **Discuss first** for product or architecture changes: open a [GitHub issue](https://github.com/prakashrx/pispark/issues) that says which part of the vision it serves, what Pi already provides and what PiSpark needs to own. Agree on it before building.
2. **Set up:** Node 22 (22.23.4+), 24 or 26+ and npm 10+, then `npm ci` and `npm run dev` ([development](docs/development.md)). Nothing else is needed: no configuration file, no terminal Pi, no credentials. Use a separate data folder for development (`PISPARK_HOME`), and never run paid model calls as tests.
3. **Keep the shape:** the server in `apps/server` (its three zones, see [architecture](docs/architecture.md)), the web in `apps/web`, the launcher in `apps/launcher`, explanations in `docs/`. Prefer a small concrete component to a speculative abstraction.
4. **Test what changed.** Tests use real Pi sessions with a deterministic local provider. Don't present unbuilt features as working.
5. **Before a PR:** `npm run check`, `npm test`, `npm run build` and `npm run smoke`. For UI changes, also the browser suite in [development](docs/development.md), at narrow and wide widths and with the keyboard. Update the docs when behavior, commands or boundaries change.

Commit the root lockfile when dependencies change. Never commit credentials, environment files, private work records, runtime data or personal screenshots, and keep machine-specific paths out of public docs.

Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes.
