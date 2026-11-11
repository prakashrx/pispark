# Working on PiSpark

## Start here: VISION.md is authoritative

**Read [VISION.md](VISION.md) in full before planning, implementing, or reviewing work. Re-read the relevant sections before making architectural or product decisions.**

**Pi runs the agent. PiSpark hosts the experience. Extensions make it their own.**

VISION.md is the single source of truth for product direction and architectural principles. This file translates it into working rules; README and architecture docs describe current implementation, not competing visions. Historical plans, prototypes, fixtures, and task notes do not override it. If guidance conflicts, flag and reconcile the conflict with VISION.md rather than silently following stale instructions. Do not rewrite the vision to justify an implementation.

- At task start, identify the relevant vision sections, intended outcome, and non-goals.
- In design proposals, explain what Pi already provides and what PiSpark genuinely needs to own.
- Before delivery/review, check the result against the vision and report deviations or unresolved decisions.
- Include this authority and relevant vision context in delegated task handoffs. Task creation, a vision statement, or a passing review is not implementation or publication authorization.

## Non-negotiable ownership boundaries

- **Pi is the engine:** use its Agent SDK and native extension/resource mechanisms. Do not reproduce model interaction, tools, context, compaction, or extension lifecycle in a competing agent framework. Keep integration small and explicit.
- **PiSpark is the workspace:** own session hosting, navigation, configuration experience, presentation, and client communication. Backend-owned sessions must be independent of browser lifetime and support concurrent independent operation; future clients use the same runtime.
- **Extensions own their experiences:** ordinary Pi extensions may add their own Svelte components and interactions. PiSpark hosts placement, loading, mounting, updating, disposal, and communication—not domain-specific extension behavior.
- Do not limit extension UI to built-in widgets or invent a separate mandatory PiSpark extension framework, manifest, or package ecosystem when Pi's native mechanisms suffice. Web presentation is additive; retain terminal compatibility where supported.
- Treat `host.call()` and `host.on()` in the vision as conceptual communication semantics, not an already implemented or frozen API. Keep transport details out of extension-owned UI and domain semantics out of the host.
- **Personas compose capabilities**, not just personality prompts. Resolve instructions, skills, extensions, commands, model preferences, and resources through Pi's native capabilities wherever possible. Sources provide discovery/configuration UX, not a competing ecosystem.
- Isolate PiSpark configuration, credentials, resources, and session history from terminal Pi unless explicitly configured otherwise. Explicit loading is not a security sandbox.
- Third-party backend code and browser components are deliberate trust boundaries. Validate client inputs, keep secrets server-side, and define resource ownership, errors, cancellation, and cleanup; do not claim isolation that is not implemented.

## Backend work starts with evidence and approval

Follow VISION.md §11: inspect the current Pi SDK and extension APIs before proposing substantial integration. Present the smallest coherent design, identify unresolved decisions, and obtain approval before substantial implementation.

Start with real agent execution and session interaction, then resource composition and extension-to-web communication. Account for extension hosting from the beginning without implementing every capability upfront. Conceptual responsibilities are not prescribed services, packages, classes, protocols, databases, or worker models.

## Quiet, consistent, extensible UI

- **Quiet by default. Powerful when you reach for it.** Preserve the accepted four-screen frontend and shared shell unless a visual change is approved. Keep unapproved prototypes separate; do not expand or redesign the product silently.
- Keep one shared application shell and persistent global Ask across routes. Use common controls, tokens, geometry, and state ownership—not page-specific copies or cosmetic variants. Ask and reply share a foundation but retain distinct context/drafts.
- Ask context consists of working directory, persona, optional persona-defined style, and model. Folder paths belong to the backend host, not implicitly the browser machine.
- Prefer small typed Svelte components, semantic elements, and local state unless sharing is required. Generic primitives stay independent of domain/API concerns; feature components supply them.
- Cover keyboard navigation, labels, focus, dismissal/focus return, empty/error/loading states, and narrow/wide layouts. Status must not depend on color alone.
- Shared first-party UI foundations must not restrict extension-owned Svelte experiences to a fixed widget catalog.
- Fixtures are not runtime evidence. Never fabricate agent execution, successful saves, source connections, or health. Distinguish current behavior from future intent in UI semantics and documentation.

## Engineering, tracking, and delivery

- **Keep the server's three zones apart** ([architecture](docs/architecture.md#three-zones-in-the-server)): `contract/` imports nothing, `core/` imports only `contract/`, `http/` imports both, and the web imports only `contract/`. Put nothing in the core that only makes sense for one client's screen or one domain. `boundaries.test.ts` enforces the imports; the rest is review.
- Read existing code first. Prefer small explicit modules and reusable concrete behavior over giant components, catch-all services, generic factories, speculative abstractions, or unnecessary dependencies.
- Maintain accurate implemented-state docs; link product direction to VISION.md instead of creating another vision document.
- When `.work/` records exist, read/update relevant goals, tasks, checkpoints, and evidence. Use descriptive kebab-case names; preserve historical decisions as history, not current authority. Plans stay high-level.
- `.work/` is private and ignored. Public builds, tests, and contributors must not depend on it or globally installed skills. Never publish credentials, runtime metadata, private feedback, or personal screenshots.
- For code changes, run `npm run check`, `npm test`, `npm run build`, and `npm run smoke`. For UI changes, verify real-browser keyboard behavior, narrow/wide layouts, shared-route consistency, and production asset loading.
- Before delivery, inspect the final diff for scope, secrets/private artifacts, regressions, and needless complexity. Report actual verification, skips, remaining risks, and vision alignment. Automated checks do not replace visual acceptance.
- Commit, push, deploy, or publish only with authorization for the current work. Previous publication approval is not blanket permission for future changes.
