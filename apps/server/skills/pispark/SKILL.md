---
name: pispark
description: Help the person use or configure PiSpark from chat. Read this for workspace settings, models, sessions, files and rendering, creating or editing agents, or choosing PiSpark tools for background or later work.
---

# Work in PiSpark

Help the person set up the workspace they need. Before changing anything, identify the target and scope: this session, a named agent, or the whole workspace. Clarify if the request could affect other sessions or a different installation. Use a supported operation and read back the result. If you can't act, give the exact UI path and next step. Don't edit internal settings, credentials or transcripts as a workaround.

## Own the outcome

Carry authorized work through verification and delivery. Fix routine failures and continue without asking the person to supervise retries. Pause for genuine blockers, consequential choices, or new authorization. Delegate only when it helps and the person has not asked to work with you directly; give workers the relevant context and verify their results yourself. Report outcomes, not every recoverable error.

## Sessions and files

The server owns the session; closing the browser does not stop it. Reloading a session applies changed resources and keeps the transcript; asked for while it works, it happens when the turn ends. Starting a fresh session uses the selected agent's resolved resources without the old conversation.

- Save reports, images and other deliverables in the session files directory named in the system prompt. Leave source changes and project files in the project. Uploads are in the session's files, too; look under **Details → Artifacts** to open or preview them.
- Write Markdown, not raw HTML (only simple tags such as `<sub>`, `<kbd>` and `<details>` are kept). Replies render GitHub Markdown: tables with alignment, task lists, footnotes, code with its language highlighted, math (`$…$` inline, `$$…$$` on its own lines), and diagrams in ```mermaid blocks. Images show from web addresses and from this session's files: use a path such as `files/screenshot.png` for a saved image, with useful alt text. Tool image results can appear inline (for example, `read` on a supported image), and PiSpark can preview SVG from a successful `write` to an `.svg` file. Edits and tool results have their own displays, so summarize what matters rather than repeating them.

## Settings: choose the scope before changing it

| Scope | Where the person can change it |
| --- | --- |
| This session's model and thinking | Open **Details** and use the **Model** and **Thinking** controls. Change between runs. |
| Preferred model and thinking for a named agent | **Agents → [agent] → Model**. Check inherited settings before changing the shared definition. |
| Workspace default model for new sessions, provider sign-in and catalog | **Settings → Providers & models**. Use the person's sign-in UI for credentials. |
| Unattended work and concurrent runs | **Background → Pause all** or **Sessions working at once**. These affect the workspace, not just the current session. |

If acting from chat, use the documented host API when available (see below). For an uncertain command outcome, inspect its receipt or the current state before doing anything again. Never ask the person to paste credentials into chat or pass them through a shell command.

## Create or edit an agent

1. Turn the request into the smallest useful definition. Use instructions for standing behavior, a slash prompt for a repeatable request, a skill for an on-demand procedure, and an extension for code. Read `pispark-extensions` before planning or writing an extension.
2. For a new reusable setup, create a **new named agent**. PiSpark layers Default, any named parents, the selected agent, then session-only overrides. Inherit a parent only if its other resources and settings are wanted; to reuse just one skill, keep it in the new agent's own `skills/` folder with its scripts and references. Leave the working folder unbound unless the agent should always work in a particular project. Editing Default affects other agents. For a session-only edit use **Details → ⋯ → Edit agent for this session**; for a shared edit use **Agents → [agent]**.
3. Use the agent editor or the documented `/api/agents` operations. For chat-driven creation, `POST /api/agents/create` takes `{name, description?, base?}` and returns the ID. Read `/api/agents/read` with `{target:{agent:id}}` before editing. Use its revision for a definition save, and the file endpoint with the file's revision (or `null` for a new file) for instructions, prompts or skills. If a revision changed, read again and reconcile instead of overwriting. The HTTP table in `docs/agents.md` is authoritative for all request shapes.
4. Read the saved, resolved view to verify the agent, its inheritance and its resources; select it under **New session** to use it. For an existing session where resources changed, the person uses **Reload session**; for your own session, call `pispark_self` with `action: "reload"` and end your turn: you are woken with the outcome. Don't claim a new agent ran unless you actually verified a run.

## Find the running build and its documentation

Start from the absolute `SKILL.md` location Pi advertised, not the conversation's working folder. Go four directories up from its containing directory (`apps/server/skills/pispark/`) to find the checkout or installed app root. Resolve these paths inside that root:

- `docs/agents.md` — editor, layering, resource format and agent API.
- `docs/session-runtime.md` — session lifetime, settings and PiSpark tools.
- `docs/session-protocol.md` — host requests, settings, providers and model commands.
- `docs/extensions.md` — extension integration; use with the `pispark-extensions` skill.
- `apps/server/dist/` — compiled host code when present. In a source checkout, see `apps/server/src/` and `apps/web/src/` for implementation. An installed release need not have TypeScript source. If a file isn't present, say so; do not silently use a different checkout as evidence for the running version.

Use APIs only against the intended host. From the server shell, use the known loopback listener (`PORT`, default `3000`); check `GET /api/host` and match its `data` to the intended PiSpark data home. A healthy endpoint or matching data home does not identify the running build. When testing a change, verify which build was launched, separately from the worktree you edited. Don't guess if the target is ambiguous. Use the documented local request format, including the matching Origin on JSON mutations. If the operation is unavailable or refused, use the UI rather than working around it.

## Built-in tools

- **Inspect and trial extensions:** use `pispark_self` with `action: "inspect"` for the calling session. Create session-only drafts under its `extension-drafts` folder and use `pispark_extension apply` to schedule an authorized local revision. Check its outcome and use the resulting tool or view before reporting completion. Read `pispark-extensions` for the full workflow. Don't move session prototypes into a project to activate them.

Check which tools are active.

- **Title and schedule:** `pispark_set_title` leaves the person's own title alone. `pispark_schedule` asks the person to confirm later or repeating work.
- **Processes:** `pispark_start_process` returns at once. `pispark_wait` with `until` waits for a line such as a server's readiness signal; it does not prove completion. Without `until` it waits for the end and returns the result, which is then not sent again. `pispark_look` with `find` searches the retained log for exact text; a miss doesn't rule out discarded output.
- **Children:** `pispark_start_session` hands work to a session that sees only your brief. It uses the Default agent and that agent's model unless you pass `agent` (a name, your own included, or an agent definition made for it) and `model`; `folder` is yours unless you give one. It answers once, when it is done. `pispark_wait` gets the answers in your turn (all of them, or the first with `for: "any"`) and ends early if one of them raises; without it, end your turn and each answer arrives as a message. It can note progress (a line here, no turn for you) and raise what needs a decision (you are woken; answer with `pispark_send`). Name what you started by its short id (`session-1`, `process-2`): `pispark_look` lists them and shows one, `pispark_send` tells one something, `pispark_stop` stops one.
