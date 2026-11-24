# Agents

[VISION.md](../VISION.md) is authoritative. Pi owns agent execution, skills, prompt templates, extensions, tools, models and history. A PiSpark agent is a **blueprint of a Pi session**, made of Pi's own resources, that can be **layered** on other agents without changing them.

## An agent is a folder

```
<data folder>/agents/<id>/
├── agent.json
├── instructions/<name>.md     appended to Pi's system prompt, in file-name order
├── skills/<name>/SKILL.md     Agent Skills (with scripts/, references/ …)
├── prompts/<name>.md          prompt templates, run as /name
└── extensions/<name>.ts|.js|.mjs  or  extensions/<name>/index.ts   Pi extensions
```

```json
{
  "name": "Dev",
  "description": "Coding helper",
  "base": ["writer"],
  "on": ["tool:powershell"],
  "off": ["skill:poetry", "instruction:tone", "tool:write"],
  "mcpServers": { "jira": { "url": "https://mcp.example.com/jira" } },
  "settings": { "model": "openai/gpt-5.6-sol", "thinking": "medium" }
}
```

- The **ID** is a readable slug chosen at creation (`dev`, `dev-2`) and never changes; it is also the folder name. The name can change.
- **Items** are named by their file or folder name. The `resources` object explicitly selects the resources included in this layer. The editor saves a reference when you select an existing resource and creates a local file and reference when you add an owned resource.
- **Switches** use `type:name`: `instruction:`, `skill:`, `prompt:`, `extension:`, `mcp:` and `tool:`. `off` turns an inherited item or a tool off; `on` turns one back on (or turns a tool on).
- **Customizing** an inherited item means adding one with the same name; the later layer wins.
- `agent.json` is strict: unknown keys, malformed switches and `"default"` in `base` are refused, so typos never silently do nothing.
- `"folder"` makes it a [project agent](#project-agents); `"home"` makes it an [app agent](#app-agents).
- **MCP servers** are part of the format and resolution, but are **not connected to sessions yet**; the editor says so.

## Resource sources

The editor's **+** picker lists available resources. A file becomes active through a selection or an inherited selection.

- `bundled:<name>` refers to a resource shipped in the running app's `plugins/` directory, for example `plugins/extensions/web-research/`. An app update supplies the new copy. A newly bundled plugin is available to select.
- `shared:<name>` refers to a resource you install under `<data folder>/resources/`. Several agents can use one copy.
- `local:<name>` refers to a resource in the declaring agent or session layer. An inherited local reference still points to its owner.

Resource groups in JSON are `instructions`, `skills`, `prompts`, `extensions`, and `mcp`, which also name the directories used in each source. MCP entries are JSON files, or existing definitions inside an agent's `mcpServers` field. For example:

```json
{
  "name": "Web Dev",
  "resources": {
    "skills": ["shared:review-code", "local:ui-review"],
    "extensions": ["bundled:web-research"]
  }
}
```

An extension folder with an index entry can carry its own skills under `skills/<name>/SKILL.md`. These skills follow the extension when the session loads or reloads. Tool and resource changes use the current session reload flow.

### Migrating an existing installation

The server continues to read older definitions without a `resources` field. To convert them, stop the server and run `node apps/server/dist/core/agents/migrate-cli.js` with the same `PISPARK_HOME`. This previews the number of conversions. Run it again with `--apply` to back up the original definitions and convert discovered resources to local references. The report names the backup directory relative to the data folder. Repeat runs skip converted definitions.

Older app versions that predate explicit references need their original definitions. To go back after migration, stop PiSpark and restore the backed-up definitions before starting the older app. Keep the backup private, like the original config. Files owned by existing agents stay in their directories.

## Default and layering

`agents/default/` is created on first start with Pi's built-in tools (`read, bash, edit, write, grep, find, ls`). It is always the first layer of every agent, is never listed in `base`, has no parents and can't be deleted. Edit it from **Agents → Default**; changes reach every agent unless an agent switches them off.

One rule resolves any number of parents:

```
Default → parents (flattened) → this agent → the session's own layer, if any
```

1. **Flatten:** walk `base` in order, ancestors before each agent; every agent appears once, even when two parents share it.
2. **Apply in order:** each layer adds its items (a same-name item replaces the earlier one), applies its `on`/`off` switches and merges `settings` key by key. Later layers win.

Cycles and a missing parent are reported (`cycle`, `missing-parent`); at most 16 layers.

## Agents that come with PiSpark

An agent folder under the app's `plugins/agents/<id>/` ships with PiSpark: it is listed like any agent (marked **Bundled**, `bundled: true` in `AgentSummary`), its `local:` references point into its own folder, and an app update replaces it. It is read-only: `save`, the file endpoints, switches and `delete` refuse it (`built-in`), and the editor shows it without controls that change it. Other agents may build on it. Its ID is reserved: a data-folder agent of the same name is ignored, and `create` never picks it.

**Agent Builder** (`agent-builder`) helps build and improve agents. It writes an agent's files directly with Pi's `read`, `edit` and `write`, working on the agent in its working folder. It has no shell (`bash`, `powershell`) and none of PiSpark's session, schedule, process or session-extension tools. Its skills cover designing agents, instructions, skills (adapted from Anthropic's skill-creator, Apache-2.0), prompts and extensions. Its extension:

- lets `edit` and `write` run inside the working folder;
- asks the person before writing anywhere else, naming a shared resource or another agent when that's what it is, and remembers a yes for that file in the session;
- refuses files under the app's `plugins/`;
- tells the model where the agent and PiSpark's and Pi's documentation are.

The ask is not a sandbox: it covers `edit` and `write` only.

## Project agents

`"folder": "D:/dev/pispark"` in `agent.json` binds an agent to a folder on the backend host (an absolute path). An agent with a folder, its own or one a parent names, is a **project agent**.

- **It always works there.** Ask shows the folder locked ("Set by the agent") and sends none; the server uses the agent's folder and refuses a `create` command that names one.
- **It reads the folder's context files**, as Pi does in a terminal: `AGENTS.md` (or `CLAUDE.md`) in the folder and in its parent folders, through Pi's own `loadProjectContextFiles`. Sessions of every other agent read nothing from their working folder. The files are read when the session starts; **Reload session** reads them again. Pi's global file is looked for in the session's own Pi folder (`sessions/<id>/pi`, never created), so terminal Pi's is never read. Project trust stays off: no skills, prompts or extensions load from the folder.
- **Inherited** like `settings`: the nearest layer that names a folder wins, and an agent cannot unset one it inherits. Default names none, because every agent builds on it. A session's own layer names none, because a session's folder is fixed when it is created.
- **Checked when it is set:** saving a folder that does not exist is refused (`folder`). One that has gone since is reported when a session starts there.
- Changing the folder affects new sessions only. Giving an agent a folder, or taking it away, changes what its sessions read, so open sessions are flagged as changed.
- Paths belong to one machine: a project agent is local to its host.

## App agents

`"home": "desk"` in `agent.json` names the view the agent's sessions open on: the `key` of a [`session.view`](extensions.md#views-of-a-session) one of its extensions offers. An agent with a home view, its own or one a parent names, is an **app agent**: it is opened rather than talked to.

- **In the sidebar.** App agents have their own **Apps** section above the sessions. A row opens the app: its newest session or, with none, a new one, made with no first message. The row unfolds to the app's sessions and **New session**. A mark on the row says when one of its sessions is working, waiting for you, queued or needs attention. An app's sessions are not listed among the sessions.
- **The home view shows first** in each of the app's sessions. Once a person chooses a view in a session, the conversation included, that choice is kept for the session. If no extension offers a view with that key, the conversation shows.
- **Where it works.** An app with a `folder` works there (a project app). An app without one has its own folder, `<data folder>/apps/<agent id>/`, made when it is first opened; no `AGENTS.md` is read from it. Started from Ask, an app without a `folder` works in the folder chosen there.
- **Names.** PiSpark does not name an app's sessions. One with no title goes by the app's name in the header and by when it started in the app's list; a first message, the title tool or `pi.setSessionName` names it as for any session.
- **Inherited** like `folder`, and with the same limits: Default and a session's own layer name none. It is a short key (`A-Z a-z 0-9 _ . : -`, at most 64 characters). It is no part of the setup fingerprint: the agent is the same.

There is no app object, manifest or store: an app is an agent with a home view.

## Sessions use agents live

A session records only which agent it uses; nothing is copied. When its Pi session starts, the session stores a fingerprint of the resolved setup. After any agent change, open sessions whose resolved setup differs show **"The agent changed. Reload to apply it"**; **Reload session** (there, or in the session ⋯ menu) restarts the Pi session from the same transcript. Changes never apply in the middle of a run: asked for while one runs, the reload waits for it to finish. An agent that edits its own agent asks for the reload with `pispark_session` `{action:"reload"}` and is woken with the outcome. The fingerprint covers every file of a skill folder and of an extension folder (`extensions/<name>/`: its code, helpers and Svelte components); a single-file extension is that file. Edits made outside PiSpark, in an editor, count too: the server watches the agents folder. A reload compiles changed components again.

**Editing inside a session** (Details ⋯ → Edit agent for this session) writes the session's own layer in `sessions/<id>/agent/`, with the same folder shape and the session's agent as its base. The agent itself is unchanged. Closing the panel reloads the session (once the reply is done, if one runs).

Model choice for a new session: the one chosen under the New session composer, else the agent's preferred model (when signed in), else the default. If an extension switches the model with Pi's `setModel`, that model stays attached to this session when reopened. Other sessions, the agent's preference and the workspace default are unchanged.

## Agent page

Agents lists every agent, Default first. An agent's page has a short profile (its name and what it does, edited in place; its kind: Base, Bundled, App or Project; its preferred model, thinking level and working folder; **New session**), then a tab per kind of resource and **Settings**. The tabs count what's switched on.

- **Instructions, Skills, Prompts** share one layout: a list and the open item. On a phone it's the list, then the item with Back. Each item has a header with where it comes from (Only this agent, Shared · N agents, Bundled, From a parent), an on/off switch and ⋯.
  - **Instructions** are listed in reading order with word counts, and what's off last. "Everything, in order" shows the whole text and each part's share. ⋯ moves the agent's own parts up or down within its own list; inherited parts keep their layer's place.
  - **Skills** show SKILL.md beside **Use when** (its `description`, edited in place) and its other files, which open read-only.
  - **Prompts** read like the slash picker (`/name ‹args›`), with **What it's for** edited in place, and the template beside a preview where you type the arguments and see what it sends.
- **Text** uses the shared Markdown editor (`lib/markdown/MarkdownEditor.svelte`): **Preview** or **Edit**, the whole text as written with its Markdown highlighted. Changes wait for the save bar, which says where saving goes: **Save** for the agent's own file; for a shared one used by other agents, **Save for all** or **Save a copy for this agent**. Inherited and bundled text is read-only until **Make it this agent's own** copies it here, whole (a skill with its scripts and references).
- **Add** is a search dropdown of what's available and not on the agent yet (bundled, the Shared library, the agent's own folder). **Create** starts something new, named in place and saved to the Shared library (and selected here) or for this agent only.
- ⋯ also offers **Move to Shared library** for the agent's own items, and **Delete** (its own file) or **Remove from this agent** (a shared or bundled selection). Inherited items are switched off, not removed.
- **Extensions** list PiSpark's own tools first (**Built in**), then each extension with where it comes from and its tools. Opening one lists the tools it gives the agent, each with a switch. Tools are found by loading the agent's extensions without starting a session (cached by the setup's fingerprint); commands and views exist only while a session runs, so they aren't listed. Installing extensions from npm or git is not offered yet.
- **Settings:** what it builds on (Default always first, then the parents; add or remove), the app home view (the key of a `session.view` an extension offers; not for Default), where it's stored, and delete (not Default, not an agent another one builds on).
- **Routines:** `routines: [{id, name, cron, prompt}]` in `agent.json` offers runs on a schedule, each a new session of the agent; inherited like the folder. Each is off until switched on with `routine:<id>` (on Background, or in Details of one of its sessions). `hold:<extension>` allows that extension to keep the agent's sessions loaded while no one watches ([hold](session-runtime.md#hold)). Both are ordinary `on`/`off` switches and are off unless switched on.
- MCP servers are part of the format but aren't shown or connected yet.

**Ask AI** opens the agent's **Agent Builder** session beside the tabs (in their place on a phone, with Back). It's an ordinary session of the bundled `agent-builder` agent, working in the agent's folder, one per agent: the session records the agent in `edits`.

- **Working on** names what's open in the tab; × switches to the whole agent, where something new goes in the current tab. **Create** opens it on a new item; on Extensions, **Build with AI** opens it.
- Each message carries a note the conversation doesn't show (`start {context}`, [session protocol](session-protocol.md)): the tab, what's open and where its file is seen from the agent's folder, and the agent's items.
- It works on saved files only: while the open item has unsaved changes (or a new one has text), sending waits until they're saved or discarded.
- When its reply ends, the page reads the agent again and anything new it made opens. What it changed shows in its conversation, each edit as a diff; to take a change back, ask it or edit the text.
- **+** starts a new conversation: the last one is archived and no longer tied to the agent. ⋯ **Open as a session** unties it and opens it as a regular session; the next Ask AI starts another. Deleting the agent deletes its Agent Builder sessions.
- Bundled agents have none: they can't be changed.

Switches and settings save immediately; text saves from the save bar. Saves are revision-checked against the file's hash: if the file changed elsewhere, the save is refused and the latest version is shown. A session's own layer (Details ⋯ → Edit agent for this session) still uses the earlier editor.

## HTTP

All endpoints use the shared loopback Host/Origin/Fetch Metadata guard and exact JSON keys. A target is `{ "agent": id }` or `{ "session": uuid }`.

| Endpoint | Body → result |
| --- | --- |
| `GET /api/agents` | → `{agents: AgentSummary[]}`, Default first; each has `folder` when it is a project agent and `home` when it is an app agent |
| `POST /api/agents/read` | `{target}` → `AgentView` (definition, revision, layers, resolved items and tools, settings, folder and home; `error` when unresolvable). Each item's `path` is inside where its file lives (its layer, the Shared library or `plugins/`); a skill lists its other `files`; a shared item has `usedBy`, how many agents select it themselves (not counting agents that inherit it) |
| `POST /api/agents/resources` | `{target, type}` → `{resources}`, the eligible local, shared, and bundled resources; shared ones with `usedBy` |
| `POST /api/agents/resource/select` | `{target, type, reference, on, expectedRevision}` → `{revision}`. Saves or removes the direct selection |
| `POST /api/agents/resource/copy` | `{target, type, name, from, expectedRevision}` → `{revision}`. Copies an item whole (a skill or extension folder with all its files) from `from` (`{library: "shared" \| "bundled"}` or another layer) into this layer and selects it there, where it replaces the original by name. `exists` when this layer already has one |
| `POST /api/agents/resource/promote` | `{target, type, name, expectedRevision}` → `{revision}`. Moves one of the agent's own items (its file or folder) into the Shared library and turns `local:<name>` into `shared:<name>`; agents built on it keep it. `exists` when the library already has that name |
| `POST /api/agents/create` | `{name, description?, base?}` → `{id, revision}` |
| `POST /api/agents/save` | `{target, expectedRevision, definition}` → `{revision}`; `""` creates a session's layer |
| `POST /api/agents/delete` | `{id}` |
| `POST /api/agents/builder` | `{agent, fresh?}` → `{session}`: the agent's Agent Builder session, made in the agent's folder when it has none; `fresh` archives the current one first (no longer tied to the agent). `agent` for a bundled agent |
| `POST /api/agents/builder/release` | `{session}`: the session is no longer the agent's Agent Builder session (`edits` cleared) |
| `POST /api/agents/file/read` | `{target, path}` → `{text, revision}`; `target` may also be `{library: "shared" \| "bundled"}` |
| `POST /api/agents/file/write` | `{target, path, expectedRevision \| null, text}` → `{text, revision}`; `target` may also be `{library: "shared"}`, which changes the file for every agent that selects it and selects nothing |
| `POST /api/agents/file/delete` | `{target, path, expectedRevision}`; a skill is removed with its folder |

Editable paths are `instructions/<name>.md`, `prompts/<name>.md` and `skills/<name>/SKILL.md`; any other file in a skill's folder can be read. Reordering a layer's instructions is a `save` with its `resources.instructions` in the new order. Failures are `{error, requestId, detail?}` with safe codes; details are agent IDs, never file contents.

## Trust

Agents can enable tools, extensions and commands, and extensions are ordinary Pi extensions running in the server process with the user's permissions. Extension data folders are a convention, not a sandbox. This is a trusted single-user local app; keep it on loopback.
