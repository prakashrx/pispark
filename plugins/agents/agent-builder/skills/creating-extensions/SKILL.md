---
name: creating-extensions
description: How to build a Pi extension for an agent from Agent Builder - a new tool, slash command, integration with a service, or view in PiSpark - and wire it into the agent. Read this whenever a request needs code: calling an API, sending messages, watching something, adding a tool or command, or showing a panel.
---

# Creating extensions

An extension is a TypeScript module Pi loads into the agent's sessions. It can register tools the agent calls, slash commands the person types, event handlers, and in PiSpark, browser views. It runs with the server user's full permissions, so it needs more care than any other kind.

## First: does it need code?

Many requests that sound like "integrate with X" are a skill telling the agent how to use its built-in tools (`read`, `write`, `grep`, a CLI the agent can already run). Prefer that when it works. Build an extension when the agent needs something it can't do otherwise: an authenticated API, a long-running watcher, a structured tool with validated input, a command, or a view.

## Agree the shape, when it's open

If the request already says what the extension does (its tools, what they take and return), build it. Otherwise, before writing anything, agree with the person:

- what the agent or person can do with it: each tool or command, its input and its result;
- which service it talks to, and which environment variable holds the secret;
- what it must never do (send without asking, delete, spend);
- whether it needs a view, or tools are enough (usually they are).

## Read the API before writing

The built-in `pispark-extensions` skill covers the essentials: registering tools and commands, state, views and their contribution points. Read it. For anything it doesn't cover, search Pi's `docs/extensions.md` for the heading you need (it's long; don't read it whole), and start from the closest example in Pi's `examples/extensions/`. Paths are in the system prompt.

Where it differs for you: the `pispark-extensions` skill describes trying an extension in your own session with `pispark_session` and `pispark_extension`. You don't have those tools. You write the extension into the agent's folder, and the person tries it in a new session of the agent.

## Write it into the agent

```
extensions/<name>/index.ts      the entry point (default export)
extensions/<name>/*.ts          helpers
extensions/<name>/*.svelte      views, if any
extensions/<name>/package.json  only for npm dependencies, with a package-lock.json
```

Add `local:<name>` to `resources.extensions` in `agent.json`.

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "stock_levels",
    label: "Stock levels",
    description: "Items below their low-stock threshold, with current counts.",
    parameters: Type.Object({ threshold: Type.Optional(Type.Integer({ minimum: 0 })) }),
    async execute(_id, params, signal) {
      // …fetch, honor `signal`, and return what the model needs
      return { content: [{ type: "text", text: "3 items low: …" }], details: undefined };
    },
  });
}
```

Good practice:

- **Register tools in the default export**, so the agent page can list them without starting a session. Keep that registration free of reads, writes and network calls.
- **Tool descriptions are prompts.** Say what the tool does and when to use it; name parameters clearly and bound them.
- **Return what the model needs**, concisely, and throw a clear error on failure. Honor the abort `signal`.
- **Secrets never go in code or files.** Read them from `process.env` (the person sets them in the instance's private `.env` file and restarts the server). If one is missing, register nothing or fail with a clear message naming the variable, as PiSpark's bundled `web-research` extension does.
- **Ask before consequential actions** (sending, deleting, paying) with `ctx.ui.confirm`, unless the person has said otherwise.
- **Keep it small.** One extension per capability; no frameworks.

## Check it, then hand it over

You can't run it, so check it carefully:

- the imports exist and the default export is a function taking `pi`;
- schemas match how `execute` uses the parameters;
- errors, cancellation and missing settings are handled;
- `agent.json` references it.

In the summary, say what it adds (each tool and command), which environment variables it needs, what it can reach, and that its tools show on the agent page and work in a **new session**. Say plainly that you haven't run it.

An installed package's code (`bundled:` or a package in the Shared library) isn't the agent's to change. To change what it does, build a new extension in the agent's folder.
