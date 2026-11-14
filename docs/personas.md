# Personas

[VISION.md](../VISION.md) is authoritative. Pi owns agent execution, skills, prompt templates, extensions, tools, models and history. A PiSpark persona is a **blueprint of a Pi session**, made of Pi's own resources, that can be **layered** on other personas without changing them.

## A persona is a folder

```
<data folder>/personas/<id>/
├── persona.json
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
- `persona.json` is strict: unknown keys, malformed switches and `"default"` in `base` are refused, so typos never silently do nothing.
- `"folder"` makes it a [project persona](#project-personas); `"home"` makes it an [app persona](#app-personas).
- **MCP servers** are part of the format and resolution, but are **not connected to chats yet**; the editor says so.

## Default and layering

`personas/default/` is created on first start with Pi's built-in tools (`read, bash, edit, write, grep, find, ls`). It is always the first layer of every persona, is never listed in `base`, has no parents and can't be deleted. Edit it from **Settings → General → Edit Default**; changes reach every persona unless a persona switches them off.

One rule resolves any number of parents:

```
Default → parents (flattened) → this persona → the chat's own layer, if any
```

1. **Flatten:** walk `base` in order, ancestors before each persona; every persona appears once, even when two parents share it.
2. **Apply in order:** each layer adds its items (a same-name item replaces the earlier one), applies its `on`/`off` switches and merges `settings` key by key. Later layers win.

Cycles and a missing parent are reported (`cycle`, `missing-parent`); at most 16 layers.

## Project personas

`"folder": "D:/dev/pispark"` in `persona.json` binds a persona to a folder on the backend host (an absolute path). A persona with a folder, its own or one a parent names, is a **project persona**.

- **It always works there.** Ask shows the folder locked ("Set by the persona") and sends none; the server uses the persona's folder and refuses a `create` command that names one.
- **It reads the folder's context files**, as Pi does in a terminal: `AGENTS.md` (or `CLAUDE.md`) in the folder and in its parent folders, through Pi's own `loadProjectContextFiles`. Sessions of every other persona read nothing from their working folder. The files are read when the session starts; **Reload chat** reads them again. Pi's global file is looked for in the session's own agent folder, so terminal Pi's is never read. Project trust stays off: no skills, prompts or extensions load from the folder.
- **Inherited** like `settings`: the nearest layer that names a folder wins, and a persona cannot unset one it inherits. Default names none, because every persona builds on it. A chat's own layer names none, because a session's folder is fixed when it is created.
- **Checked when it is set:** saving a folder that does not exist is refused (`folder`). One that has gone since is reported when a session starts there.
- Changing the folder affects new sessions only. Giving a persona a folder, or taking it away, changes what its sessions read, so open chats are flagged as changed.
- Paths belong to one machine: a project persona is local to its host.

## App personas

`"home": "desk"` in `persona.json` names the view the persona's sessions open on: the `key` of a [`session.view`](extensions.md#views-of-a-session) one of its extensions offers. A persona with a home view, its own or one a parent names, is an **app persona**: it is opened rather than chatted with.

- **In the sidebar.** App personas have their own **Apps** section above the chats. A row opens the app: its newest session or, with none, a new one, made with no first message. The row unfolds to the app's sessions and **New session**. A mark on the row says when one of its sessions is working, waiting for you, queued or needs attention. An app's sessions are not listed among the chats.
- **The home view shows first** in each of the app's sessions. Once a person chooses a view in a session, the conversation included, that choice is kept for the session. If no extension offers a view with that key, the conversation shows.
- **Where it works.** An app with a `folder` works there (a project app). An app without one has its own folder, `<data folder>/apps/<persona id>/`, made when it is first opened; no `AGENTS.md` is read from it. Started from Ask, an app without a `folder` works in the folder chosen there.
- **Names.** PiSpark does not name an app's sessions. One with no title goes by the app's name in the header and by when it started in the app's list; a first message, the title tool or `pi.setSessionName` names it as for any chat.
- **Inherited** like `folder`, and with the same limits: Default and a chat's own layer name none. It is a short key (`A-Z a-z 0-9 _ . : -`, at most 64 characters). It is no part of the setup fingerprint: the agent is the same.

There is no app object, manifest or store: an app is a persona with a home view.

## Chats use personas live

A chat records only which persona it uses; nothing is copied. When its Pi session starts, the chat stores a fingerprint of the resolved setup. After any persona change, open chats whose resolved setup differs show **"The persona changed. Reload to apply it"**; **Reload chat** restarts the Pi session from the same transcript. Changes never apply in the middle of a run. The fingerprint covers every file of a skill folder and of an extension folder (`extensions/<name>/`: its code, helpers and Svelte components); a single-file extension is that file. Edits made outside PiSpark, in an editor, count too: the server watches the personas folder. A reload compiles changed components again.

**Editing inside a chat** (Chat info → Edit persona) writes the chat's own layer in `chats/<id>/persona/`, with the same folder shape and the chat's persona as its base. The persona itself is unchanged. Closing the panel reloads the chat.

Model choice for a new chat: Ask's model, else the persona's preferred model (when signed in), else the default.

## Editor

Personas lists every persona, Default first. The editor shows, for one layer:

- **Builds on:** Default (always) and the parents, in order; add or remove parents.
- **Instructions, Skills, Commands, Extensions:** every resolved item with where it comes from ("Added here", "From Writer"), whether a layer switched it, and an on/off switch. Items in this layer can be edited or removed; inherited ones can be viewed and **customized here** (copied into this layer). New instructions, skills and commands start from a template.
- **Routines:** `routines: [{id, name, cron, prompt}]` in `persona.json` offers runs on a schedule, each a new session of the persona; inherited like the folder. Each is off until switched on with `routine:<id>` (Settings → Background, or the app's Routines). `hold:<extension>` allows that extension to keep the persona's sessions loaded while no one watches ([hold](session-runtime.md#hold)). Both are ordinary `on`/`off` switches and are off unless switched on.
- **Tools:** every tool the persona has, found by loading its extensions without starting a session (Pi allows it; cached by the setup's fingerprint), with on/off switches and which layer set them. Grouped: **PiSpark** first (Pi's built-in tools and those of PiSpark's own built-in extension), then each extension, then switches naming tools nothing provides now. MCP tools appear once PiSpark connects MCP servers (not yet).
- **Model:** a preferred model and thinking level.
- **App:** the key of the home view of an app persona, or "Inherited" with the parent's. The editor cannot list views: they exist only while a session runs. Not shown for Default or a chat's own layer.
- **Working folder:** the folder of a project persona, chosen as in Ask (recent folders, home, or a path), or "Inherited" with the parent's folder. Not shown for Default or a chat's own layer.
- **Advanced:** where the persona is stored, the layer order and the raw `persona.json`; delete (not Default, not a persona another one builds on).

Every change saves immediately. Saves are revision-checked against the file's hash: if the file changed elsewhere, the save is refused and the latest version is shown.

## HTTP

All endpoints use the shared loopback Host/Origin/Fetch Metadata guard and exact JSON keys. A target is `{ "persona": id }` or `{ "chat": uuid }`.

| Endpoint | Body → result |
| --- | --- |
| `GET /api/personas` | → `{personas: PersonaSummary[]}`, Default first; each has `folder` when it is a project persona and `home` when it is an app persona |
| `POST /api/personas/read` | `{target}` → `PersonaView` (definition, revision, layers, resolved items and tools, settings, folder and home; `error` when unresolvable) |
| `POST /api/personas/create` | `{name, description?, base?}` → `{id, revision}` |
| `POST /api/personas/save` | `{target, expectedRevision, definition}` → `{revision}`; `""` creates a chat's layer |
| `POST /api/personas/delete` | `{id}` |
| `POST /api/personas/file/read` | `{target, path}` → `{text, revision}` |
| `POST /api/personas/file/write` | `{target, path, expectedRevision \| null, text}` → `{text, revision}` |
| `POST /api/personas/file/delete` | `{target, path, expectedRevision}`; a skill is removed with its folder |

Editable paths are `instructions/<name>.md`, `prompts/<name>.md` and `skills/<name>/SKILL.md`. Failures are `{error, requestId, detail?}` with safe codes; details are persona IDs, never file contents.

## Trust

Personas can enable tools, extensions and commands, and extensions are ordinary Pi extensions running in the server process with the user's permissions. Extension data folders are a convention, not a sandbox. This is a trusted single-user local app; keep it on loopback.
