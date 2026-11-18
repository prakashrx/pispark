---
name: pispark-extensions
description: Read this before you suggest, plan or write anything that adds to PiSpark's interface. PiSpark runs ordinary Pi extensions and lets them show their own Svelte web components in a session, such as views, panels above or below the reply box, controls, chips and custom renderings of tool results. Covers how they work, where they live and how they get loaded.
---

# Extensions in PiSpark

An extension is an ordinary Pi extension: a folder with `index.ts` whose default export receives `pi`. It can register tools, commands, message renderers and event handlers, exactly as in terminal Pi.

In PiSpark it can also show **its own Svelte components** in the session. There is no PiSpark API, manifest or second entry file: it emits one event on Pi's own event bus. Terminal Pi ignores the event and keeps its terminal rendering.

## Showing a component

```ts
export default function (pi) {
  let count = 0;
  const show = () =>
    pi.events.emit("pispark:view", {
      point: "session.input.above",
      component: new URL("./Counter.svelte", import.meta.url),
      props: { count },
      calls: { add: (by) => { count += by; show(); return count; } },
    });
  pi.on("session_start", () => show());
}
```

```svelte
<script>
  let { session, data, host, count } = $props();
</script>
<button onclick={() => host.call("add", 1)}>Count {count}</button>
```

- **Updating:** emit again with new props and the mounted component updates in place.
- **Removing:** leave out `component`.
- **Several at one point:** use `key` to tell several components at the same point apart.
- **Props a component gets:**
  - `session`: the live session, with `doc`, `items`, `send(text)`, `stop()`, `answer()`, `views` and `showView()`;
  - `data`: what the point draws, such as a tool call;
  - `host`;
  - your own props.
- **`host.call(name, data)`** runs one of the functions in `calls`, on the server, and resolves with its result. Data and results are JSON of at most 64 KiB; a call times out after 30 s.
- **`files`** names a folder the component may read. `host.file("a.png")` then gives an address for `<img>` or `fetch`.
- **Imports:** a component may import images or fonts from its own folder, `.svelte` files, TypeScript, and npm packages installed in the extension's folder. It is compiled on the server and uses PiSpark's theme tokens (`var(--foreground)`, `var(--muted-foreground)`, `var(--border)`, `var(--interactive)`, `var(--accent)`).

## Where components can go (points)

| Point | Where it shows |
| --- | --- |
| `session.view` | A whole view of the session beside the conversation. Needs `key` and `title`. The person switches views; `attention: true` asks to be shown. |
| `session.input.above` / `session.input.below` | Above or below the reply box |
| `session.input.actions` | Small actions beside Send |
| `session.header` | Under the session's notices |
| `session.status` | In the status line under the reply box |
| `session.title` | Small chips beside the session's name |
| `item.tool:<name>` | Replaces how every call of that tool is drawn in the conversation |
| `item.custom:<type>` | Draws custom messages or entries of that type |

The extension owns what is inside the component; PiSpark owns where it sits. Keep components quiet and small, and readable on a phone.

## State

Keep state where Pi keeps an extension's state: `pi.appendEntry(type, data)` when it changes, read back on `session_start` from `ctx.sessionManager.getBranch()`. It survives reloads and restarts. Files too large for that go in `<ctx.sessionManager.getSessionDir()>/extensions/<name>/`.

## Where an extension lives, and loading it

- **Its folder:** an agent's extensions live in `<data folder>/agents/<agent id>/extensions/<name>/index.ts`. The system prompt gives the data folder. Each agent's `agent.json` says its name; Default is `default`.
- **Taking effect:** PiSpark watches those folders. When an extension changes, open sessions of that agent say "The agent changed", and the person reloads the session to load it. A running session does not load new extensions by itself, so tell the person when a reload is needed.
- **Writing one:** prefer a new extension folder to editing someone else's. Explain what it will do before writing it, because extensions run with the person's permissions on their machine.
- **Further reading:** PiSpark's `docs/extensions.md` and Pi's own `docs/extensions.md` describe the full API.
