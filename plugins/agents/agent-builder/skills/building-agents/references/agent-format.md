# How PiSpark stores an agent

The authority is PiSpark's `docs/agents.md`, whose path is in the system prompt's Agent Builder section. This is the part you need while editing.

## The folder

```
<data folder>/agents/<id>/
├── agent.json
├── instructions/<name>.md        added to the system prompt, in the order listed in agent.json
├── skills/<name>/SKILL.md        with scripts/, references/, assets/ as needed
├── prompts/<name>.md             run as /name
└── extensions/<name>/index.ts    or extensions/<name>.ts
```

Names are lowercase letters, numbers and hyphens. The ID is the folder name and never changes; the `name` field can.

## agent.json

```json
{
  "name": "Release helper",
  "description": "Prepares and checks releases for the shop.",
  "base": ["writer"],
  "on": ["tool:powershell"],
  "off": ["tool:bash", "skill:poetry"],
  "settings": { "model": "openai/gpt-5.6-sol", "thinking": "medium" },
  "resources": {
    "instructions": ["local:release-rules"],
    "skills": ["local:release-checklist", "shared:review-code"],
    "prompts": ["local:changelog"],
    "extensions": ["bundled:web-research"]
  }
}
```

- **It is strict.** Unknown keys, malformed switches, and `"default"` in `base` are refused, and the agent shows an error until fixed. Keep it valid JSON. Re-read it after every edit.
- **`resources` selects what this layer includes**, in order:
  - `local:<name>`: a file in this agent's own folder;
  - `shared:<name>`: one copy in `<data folder>/resources/<kind>/`, used by several agents;
  - `bundled:<name>`: shipped with PiSpark in its `plugins/` folder.

  **A file in the folder does nothing until it's referenced.** When you add `skills/release-checklist/SKILL.md`, also add `"local:release-checklist"` to `resources.skills`.
- **Switches** are `type:name` in `on` and `off`: `instruction:`, `skill:`, `prompt:`, `extension:`, `mcp:`, `tool:`. `off` turns off an inherited item or a tool; `on` turns one back on.
- **`base`** lists parent agents. **`folder`** (an absolute path) binds it to a project. **`settings`** sets a preferred model and thinking level.

## Layering

```
Default → parents (in order) → this agent → a session's own edits
```

Each layer adds its items; a same-name item replaces the earlier one in the earlier one's position. Switches and settings apply in order, later wins. To change an inherited item for this agent only, copy it into this agent's folder under the same name and reference it as `local:`.

## Shared and inherited files

Shared files (`<data folder>/resources/`) and other agents' files reach every agent that uses them. The person is asked before you can write there. Bundled files can't be changed: copy them instead.

## How changes reach sessions

Sessions read agents live. After a change, open sessions of the agent offer **Reload**; nothing changes under them until the person accepts. A new session uses the latest files. So the person tests a change with **New session** on the agent's page.
