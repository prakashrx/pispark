# Working on PiSpark

## Product and engineering principles

- Preserve Pi's simplicity: small explicit modules, clear ownership, and extensibility through deliberate boundaries—not layers of speculative abstractions.
- Build the smallest useful slice. Keep the project flexible; distinguish confirmed requirements, proposals, mockups, and implemented behavior.
- Read existing code and relevant documentation before changing it. Reuse established patterns; avoid parallel implementations of the same control or behavior.
- Prefer readable typed functions and composition. Avoid giant components, catch-all services, unnecessary class hierarchies, generic factories, and configuration-driven frameworks without a demonstrated need.
- Keep dependencies purposeful. Do not add a library or package boundary to solve a hypothetical future problem.

## Design approval comes first

- The original green-tinted starter dashboard is not an approved visual direction. Do not extend its decorative styling.
- Before substantial UI changes, present reviewable mockups for all affected screens and interaction states, with a locally persisted comment layer, and obtain explicit approval. Record decisions; approval of the foundation is not approval of its appearance.
- Keep unapproved prototypes separate from production application code. Implement designs only after explicit acceptance; commit or push only with publication authorization. Preserve feedback and reset affected approvals when a design is revised. The current four-screen frontend and shared shell are accepted for publication; backend integration remains unapproved.
- Aim for a clean, professional, quiet workspace: restrained neutral surfaces, readable typography, subtle borders, consistent spacing, and minimal distraction.
- Avoid hero slogans, promotional cards, decorative gradients, oversized headings, and saturated background palettes. Use color sparingly for meaningful states.
- Do not select a final palette or expand the design without approval. A small green status dot does not imply a green application theme.

## Required workspace direction

- Collapsible sidebar with Sessions, Archived, and Settings; sessions grouped by day in collapsible sections.
- Logo at the upper left with a simple status dot. Give status an accessible text equivalent and report what it actually measures.
- A top Ask bar spans the available content width. Put folder, Persona, optional Style, and Model selectors on its right; adapt cleanly on narrow screens.
- Show Style only when the selected persona supplies styles.
- Folder selection supports typing and a clean autocomplete dropdown. Resolve folders on the backend's machine, not implicitly on the browser's machine.
- The global Ask composer and session follow-up composer share controls, styling, and interaction conventions. Clearly distinguish launching a session from replying to one.
- These are enduring requirements. The current frontend uses local fixtures; folder resolution, sessions, and other runtime behavior still require backend integration.

## Frontend: reusable, accessible, consistent

- Put generic independent UI primitives in a common frontend module area; compose them into feature-specific components.
- Buttons, icon buttons, inputs, textareas, checkboxes, selectors, dropdown surfaces, and focus/disabled/error states must use shared primitives and styles—not bespoke copies in each feature.
- Use one reusable selector/combobox foundation for folder, persona, style, model, and other applicable pickers. Preserve correct semantics: action menus and value selection are not interchangeable.
- Generic controls accept typed data, values, and callbacks; they do not know about personas, sessions, API routes, or working directories. Domain adapters supply that behavior.
- Share a composer foundation between Ask and follow-up inputs; configure differences explicitly rather than duplicating markup and styles.
- Centralize colors, typography, spacing, borders, and state styles in design tokens. Avoid arbitrary per-screen values and inline theme overrides.
- Prefer semantic native elements and Svelte composition. Keep reactive state local unless sharing is actually needed; do not introduce a global store for every interaction.
- Support keyboard navigation, labels, visible focus, Escape/dismissal, focus return, loading/error/empty states, and mobile layout. Status cannot rely on color alone.
- Keep mock data and demo behavior visibly distinct from real runtime behavior. Never fabricate successful agent runs or backend capabilities.

## Backend: simple modules, independent runtime

- Keep HTTP handlers, runtime operations, and persistence responsibilities separate where they exist. Extract concrete shared behavior, not speculative service/repository frameworks.
- Sessions belong to the backend runtime. Web and future messaging channels are interfaces to it; headless use must not require a web UI.
- Integrate Pi through its SDK with explicit resource loading. Never silently inherit terminal Pi's credentials, settings, skills, extensions, or sessions.
- Validate external input at boundaries, return clear errors, and support cancellation and cleanup for owned resources. Do not swallow failures.
- Keep secrets server-side and logs safe. Configuration/process isolation is not a security sandbox; do not claim otherwise.
- Add extension interfaces only for demonstrated needs, with narrow contracts and clear ownership. Avoid exposing internal mutable state as a public API.

## Work tracking and delivery

- When local `.work/` records exist, read the relevant goal and task metadata, track checkpoints, and preserve references and evidence. Use descriptive kebab-case work/task names, not numbered placeholders.
- Optional `PLAN.md` files contain high-level outcomes only. Put detailed findings, mockups, attachments, and decisions in the relevant `files/` directory.
- `.work/` is private and ignored. Public contributors must not need it or a globally installed skill; keep shareable project guidance in this file and `docs/`.
- Keep chat updates concise. Do not treat an unapproved proposal as a settled decision, or task creation as authorization for unrelated implementation or publication.
- Test changed behavior. Run `npm run check`, `npm test`, `npm run build`, and `npm run smoke` for code changes; Makefile targets wrap the same commands.
- For UI changes, verify keyboard interactions, desktop/mobile layouts, and consistent control states in a real browser. Automated checks do not replace visual approval.
- Review the final diff for accidental files, credentials, private artifacts, regressions, and unnecessary complexity. Report what passed, what was skipped, and what remains incomplete.
