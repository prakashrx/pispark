---
name: pispark-extensions
description: Design, write, or troubleshoot ordinary Pi extensions hosted by PiSpark. Read before adding tools, extension-owned state, custom rendering, or Svelte panels, views and controls. Covers scope, loading, and how to verify an extension in a live session.
---

# Extensions in PiSpark

Use an ordinary Pi extension for executable behavior. Register tools with Pi for things the session's agent needs to do. Add a browser component only when the person needs a display or control. A tool does not need a component, and a read-only panel does not need a model turn. PiSpark hosts both; the extension owns its behavior and state. There is no separate manifest or runtime.

## Choose where it loads before writing

- **Named agent:** put the extension under `<PiSpark data folder>/agents/<id>/extensions/<name>/index.ts`. All sessions that resolve that resource can load it on start or reload, including agents that inherit it. For an isolated dev agent, use its own folder and select it in a separate dev workspace; don't add trials to Default. Agent layering controls where code loads, not what it can access. Extensions run with the host user's permissions; their components run in the PiSpark page.
- **One session:** write the editable source under `sessions/<id>/extension-drafts/<name>/`. This folder never auto-loads. Use `pispark_extension` with `{ action: "apply", name: "<name>" }` after the user authorizes building and running the draft in this session. Don't copy a session prototype into the project or edit the host's revision storage. Use `agent/extensions` only for explicitly configured, normally loaded resources; there is no built-in promotion action to a named agent.
- Declare runtime npm dependencies in the draft's package.json and include an npm package-lock.json. Apply prepares the locked registry packages without install scripts. Keep the draft source-only and use ordinary imports.
- A component needs a folder extension: keep its `.svelte` file and helpers beside the entry point. Resolve paths with `new URL('./…', import.meta.url)`, not the person's project folder. Confirm the target and what the code will do before editing. Work on the agent in its intended data home; use work records for plans and evidence, not as a second source tree.

## Tools, components, and state

1. **Register tools in the extension's default export**, not only when a view opens. This lets the agent editor discover them without starting a session. Keep registration free of session-specific reads, writes and background work. Give tools a bounded input schema and concise description; honor cancellation and return a useful result or a clear error.
2. **Read the session's state in the tool's `ctx` or in `session_start`.** Use the same backend functions for a tool and a panel action that do the same job. The component calls only the functions its contribution offers via `host.call(name, data)`; it should not edit state files or call unrelated workspace APIs. Calls carry JSON up to 64 KiB and time out after 30 s. Bound I/O and surface loading and errors. Do not expose secrets or raw logs in props, call results, or `host.file`.
3. **Store mutable session data with the session.** Use namespaced `pi.appendEntry` entries for small state that should follow the conversation branch, and restore them from `ctx.sessionManager.getBranch()`. Use files under `ctx.sessionManager.getSessionDir()/extensions/<name>/` for file-backed state (for example, an explicitly selected preview target). Have the extension create and manage those files through its tools; don't ship mutable state in the agent definition or ask the model to hand-edit it. If tools write files, see Pi's `withFileMutationQueue` guidance. No state should leak to another session just because it uses the same agent.

## Offer a panel

```ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    pi.events.emit('pispark:view', {
      point: 'session.details',
      key: 'project-location',
      title: 'Project location',
      component: new URL('./Location.svelte', import.meta.url),
      props: { folder: ctx.cwd },
    });
  });
}
```

```svelte
<script>
  let { folder } = $props();
</script>
<p>{folder}</p>
```

- `session.details` adds a foldable panel beside Context and Artifacts. `session.view` offers a whole view without replacing the conversation by default. The full tab fills the available workspace. Set the extension’s own readable width or gutters, and adapt its layout to the container size. For smaller additions, use `session.title`, `session.header`, `session.status`, or `session.input.above`, `.below` and `.actions`.
- Use `item.tool:<name>` for a tool card or `item.custom:<type>` for custom entries and messages. See the docs for what each point passes as `data` and what it replaces.
- The component can read its live `session`, contribution `data`, `host` and its own props. Re-emit with the same point and key to update props; omit `component` to remove it. Load expensive facts on demand rather than polling while the panel is closed. Use PiSpark's theme tokens and keep controls usable at both wide and narrow sizes.

## Reload and verify the real path

- Apply and unload take effect after the current run settles. Use `{ action: "unload", name: "<name>" }` to remove a trial's active revision while retaining its draft. For a project source, stage the exact revision and obtain approval to activate it. For normal agent resources, use **Reload session** when idle.
- Treat a scheduled change as pending. Use the completion notice or inspect the outcome after reload, then exercise the tool or view at the scope you agreed to verify. For interactive views, perform a real interaction at the relevant width. Build for the current session when the user requests a live trial. Test changes to PiSpark itself on an isolated dev host.
- Own verification: use `pispark_session inspect` to check the active revision, tools, contributions, and errors. Then actually call the tool or open and exercise the panel in a real browser; a contribution is not proof of a render. Fix routine failures yourself within the agreed scope. When someone wants to build the extension with you, do it in their session; don't hand it to a background agent. Read any startup or compile notice. If you still see old behavior after a session reload, verify the checkout/build, data home and extension path before changing code again. Reproduce against the intended dev host, not the installation serving the conversation.
- For state, change it using the tool or control, reload or reopen, and confirm the expected value. Open a second session of the same agent to check isolation. Saving files is not evidence that a tool executed or a view rendered. Report what you checked and what's still unverified.

## References

The PiSpark app root is four directories above this skill's containing directory (`apps/server/skills/pispark-extensions/`). Read its `docs/extensions.md` for the contribution contract and supported UI APIs, and `docs/agents.md` for layering. Use the Pi SDK docs and examples named in the system prompt for tool schemas, lifecycle, and persistence. An installed build may have compiled code rather than a source checkout; do not assume a nearby checkout is the running build.
