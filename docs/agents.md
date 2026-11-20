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
- **Items** are named by their file or folder name. Adding an item means putting the file in the folder (the editor does this).
- **Switches** use `type:name`: `instruction:`, `skill:`, `prompt:`, `extension:`, `mcp:` and `tool:`. `off` turns an inherited item or a tool off; `on` turns one back on (or turns a tool on).
- **Customizing** an inherited item means adding one with the same name; the later layer wins.
- `agent.json` is strict: unknown keys, malformed switches and `"default"` in `base` are refused, so typos never silently do nothing.
- `"folder"` makes it a [project agent](#project-agents); `"home"` makes it an [app agent](#app-agents).
- **MCP servers** are part of the format and resolution, but are **not connected to sessions yet**; the editor says so.

## Default and layering

`agents/default/` is created on first start with Pi's built-in tools (`read, bash, edit, write, grep, find, ls`). It is always the first layer of every agent, is never listed in `base`, has no parents and can't be deleted. Edit it from **Agents → Default**; changes reach every agent unless an agent switches them off.

One rule resolves any number of parents:

```
Default → parents (flattened) → this agent → the session's own layer, if any
```

1. **Flatten:** walk `base` in order, ancestors before each agent; every agent appears once, even when two parents share it.
2. **Apply in order:** each layer adds its items (a same-name item replaces the earlier one), applies its `on`/`off` switches and merges `settings` key by key. Later layers win.

Cycles and a missing parent are reported (`cycle`, `missing-parent`); at most 16 layers.

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

A session records only which agent it uses; nothing is copied. When its Pi session starts, the session stores a fingerprint of the resolved setup. After any agent change, open sessions whose resolved setup differs show **"The agent changed. Reload to apply it"**; **Reload session** restarts the Pi session from the same transcript. Changes never apply in the middle of a run. The fingerprint covers every file of a skill folder and of an extension folder (`extensions/<name>/`: its code, helpers and Svelte components); a single-file extension is that file. Edits made outside PiSpark, in an editor, count too: the server watches the agents folder. A reload compiles changed components again.

**Editing inside a session** (Details ⋯ → Edit agent for this session) writes the session's own layer in `sessions/<id>/agent/`, with the same folder shape and the session's agent as its base. The agent itself is unchanged. Closing the panel reloads the session.

Model choice for a new session: the one chosen under the New session composer, else the agent's preferred model (when signed in), else the default. If an extension switches the model with Pi's `setModel`, that model stays attached to this session when reopened. Other sessions, the agent's preference and the workspace default are unchanged.

## Editor

Agents lists every agent, Default first. The editor shows, for one layer:

- **Builds on:** Default (always) and the parents, in order; add or remove parents.
- **Instructions, Skills, Prompts, Extensions:** every resolved item with where it comes from ("Added here", "From Writer"), whether a layer switched it, and an on/off switch. Items in this layer can be edited or removed; inherited ones can be viewed and **customized here** (copied into this layer). New instructions, skills and prompts start from a template; a prompt runs by typing `/name`.
- **Routines:** `routines: [{id, name, cron, prompt}]` in `agent.json` offers runs on a schedule, each a new session of the agent; inherited like the folder. Each is off until switched on with `routine:<id>` (on Background, or in Details of one of its sessions). `hold:<extension>` allows that extension to keep the agent's sessions loaded while no one watches ([hold](session-runtime.md#hold)). Both are ordinary `on`/`off` switches and are off unless switched on.
- **Tools:** every tool the agent has, found by loading its extensions without starting a session (Pi allows it; cached by the setup's fingerprint), with on/off switches and which layer set them. Grouped: **PiSpark** first (Pi's built-in tools and those of PiSpark's own built-in extension), then each extension, then switches naming tools nothing provides now. MCP tools appear once PiSpark connects MCP servers (not yet).
- **Model:** a preferred model and thinking level.
- **App:** the key of the home view of an app agent, or "Inherited" with the parent's. The editor cannot list views: they exist only while a session runs. Not shown for Default or a session's own layer.
- **Working folder:** the folder of a project agent, chosen as for a new session (recent folders, home, or a path), or "Inherited" with the parent's folder. Not shown for Default or a session's own layer.
- **Advanced:** where the agent is stored, the layer order and the raw `agent.json`; delete (not Default, not an agent another one builds on).

Every change saves immediately. Saves are revision-checked against the file's hash: if the file changed elsewhere, the save is refused and the latest version is shown.

## HTTP

All endpoints use the shared loopback Host/Origin/Fetch Metadata guard and exact JSON keys. A target is `{ "agent": id }` or `{ "session": uuid }`.

| Endpoint | Body → result |
| --- | --- |
| `GET /api/agents` | → `{agents: AgentSummary[]}`, Default first; each has `folder` when it is a project agent and `home` when it is an app agent |
| `POST /api/agents/read` | `{target}` → `AgentView` (definition, revision, layers, resolved items and tools, settings, folder and home; `error` when unresolvable) |
| `POST /api/agents/create` | `{name, description?, base?}` → `{id, revision}` |
| `POST /api/agents/save` | `{target, expectedRevision, definition}` → `{revision}`; `""` creates a session's layer |
| `POST /api/agents/delete` | `{id}` |
| `POST /api/agents/file/read` | `{target, path}` → `{text, revision}` |
| `POST /api/agents/file/write` | `{target, path, expectedRevision \| null, text}` → `{text, revision}` |
| `POST /api/agents/file/delete` | `{target, path, expectedRevision}`; a skill is removed with its folder |

Editable paths are `instructions/<name>.md`, `prompts/<name>.md` and `skills/<name>/SKILL.md`. Failures are `{error, requestId, detail?}` with safe codes; details are agent IDs, never file contents.

## Trust

Agents can enable tools, extensions and commands, and extensions are ordinary Pi extensions running in the server process with the user's permissions. Extension data folders are a convention, not a sandbox. This is a trusted single-user local app; keep it on loopback.
