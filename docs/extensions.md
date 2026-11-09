# Pi extensions in PiSpark

[VISION.md](../VISION.md) §2 and §7 are authoritative: extensions are ordinary Pi extensions, and web presentation is additive. PiSpark runs them unchanged. Whatever UI they use through Pi has a web counterpart where one exists; nothing PiSpark-specific is needed in the extension.

## How it works

Each chat is one Pi `AgentSession`. PiSpark binds Pi's **`rpc` mode** with its own `ExtensionUIContext` (`apps/server/src/extensions/extension-ui.ts`). That is the capability set Pi defines for clients that are not a terminal, so extensions keep using `ctx.hasUI` / `ctx.mode` as they already do. What extensions show is session state in the chat's snapshot; the browser draws it.

Extensions style text with Pi's theme. PiSpark gives them a theme whose colors stand for a few PiSpark roles (accent, success, warning, danger, muted, subtle, border, selected), turns the terminal output into styled spans on the server, and the browser draws the spans with the current PiSpark theme's tokens (`extensions/styled-text.ts`, `StyledText.svelte`). Raw terminal colors an extension picks itself pass through as colors.

Pi's terminal components are just `render(width)` → lines, so PiSpark calls an extension's own renderers on the server, with no terminal, at 80 columns (`extensions/extension-render.ts`). The browser wraps narrower views. Components get the parts of a TUI that render-only components use (its size and `requestRender`). Extension UI updates reach the browser at most every 100 ms, so animated titles and spinners stay cheap.

## Supported

| Pi API | In PiSpark |
| --- | --- |
| `ctx.ui.select`, `confirm`, `input`, `editor` | A question card above the reply box, with one frame for every kind: it takes focus (a confirmation starts on the question, not on an answer; a list starts on its filter or first option), Escape or Skip skips, focus returns afterwards, a timeout shows a countdown, and a hint line names the keys. Confirmations answer to Y and N; lists scroll inside the card, filter from eight options up, answer to 1–9 and show `label — detail` as two lines; text is submitted with Enter, an editor with Ctrl+Enter. Honours Pi's `timeout` and `signal`. Cancelling or stopping the chat dismisses open questions. Questions wait while no browser is watching; while one is open, the chat says "Waiting for you" in its header and the chat list. An answered or skipped question leaves a line in the chat ("Proceed? → no"); what a person typed is not echoed. |
| `ctx.ui.notify` | A line in the conversation where it happened; warnings and errors are labelled and tinted. Kept for the live session, like terminal scrollback. |
| `ctx.ui.setStatus` | A quiet status line under the reply box. |
| `ctx.ui.setWidget` (lines or a component) | Above or below the reply box, as `placement` says. |
| `ctx.ui.setEditorText`, `pasteToEditor` | Fills the reply box. |
| `ctx.ui.setWorkingMessage`, `setWorkingIndicator`, `setWorkingVisible` | The "Working…" pill while the chat runs: the extension's message, its animation frames (none hides the dot; reduced motion shows the first frame), or no pill. |
| `ctx.ui.setHiddenThinkingLabel` | The label on collapsed thinking. |
| `ctx.ui.setTitle` | The browser tab title while the chat is open (Pi's terminal window title). |
| `pi.setSessionName` | The chat title (Pi's session name), in the sidebar and header. |
| `ctx.ui.setHeader` | One extension header at the top of the conversation, under PiSpark's chat header. Last call wins; `undefined` removes it. |
| `ctx.ui.setFooter` | Replaces the status line under the reply box, as it replaces terminal Pi's footer. Footers get Pi's footer data: extension statuses, the git branch of the chat's folder and the provider count. Last call wins; `undefined` restores the status line. |
| `ctx.ui.theme` | PiSpark's role theme (above). |
| Tool `renderCall` / `renderResult`, `registerToolRenderer` | Shown inside the tool's card, collapsed view (`expanded: false`). Pi's built-in tools keep PiSpark's own cards. |
| `registerMessageRenderer` | Custom messages render in the conversation; `display: false` messages stay hidden. |
| `registerEntryRenderer` | Custom entries render among the messages, placed where they were appended. |
| `registerCommand` | Typed as `/name` in the reply box. |
| Handler errors | A notice; the chat keeps working, as in Pi. |

## Svelte components: an extension's own web views

An extension shows its own Svelte component with one event on **Pi's own event bus**, from its normal `index.ts`, and gives it the functions it may call. The component gets props and can call those functions. There is no PiSpark API, manifest or second entry file. Terminal Pi has no listener for the event, so there it does nothing and the extension's terminal rendering is used.

```ts
export default function (pi) {
  let count = 0;
  const show = () =>
    pi.events.emit("pispark:view", {
      slot: "above-reply",
      component: new URL("./Counter.svelte", import.meta.url),
      props: { count },
      calls: {
        add: (by) => { count += by; show(); return count; },
      },
    });
  show();
}
```

```svelte
<script>
  let { count, host } = $props();
</script>

<button onclick={() => host.call("add", 1)}>Count {count}</button>
```

That is the whole model: **show or update** by emitting `pispark:view` again, **remove** by leaving out `component`, **data down** as props (plus the slot's own data), **actions up** with `host.call(name, data)`, which resolves with the function's result or rejects with its error.

| Slot | Where | The component gets |
| --- | --- | --- |
| `tool:<name>` | Under each call of that tool, in the message (it replaces the default diff and pictures; the call's words and opened row stay) | `call`: its args, status, and result with Pi's `details` |
| `entry:<customType>` | Custom messages and entries of that type (entries are sent with their data) | `item`: the message or entry, its data as `details` |
| `above-reply`, `below-reply` | Around the reply box | the props sent |
| `header` | The top of the conversation | the props sent |

- **Event shape:** `{ slot, component, props?, calls?, key? }`. `component` is a `file:` URL (a `URL` or its string) or absolute path of a `.svelte` file inside the extension's own folder. `key` tells several placements in one slot apart. Emitting again with the same slot and key replaces the placement; new props for the same file update the mounted component in place.
- **Calls:** `calls[name](data, { signal })` runs in the extension, in the server. A component reaches only the functions its own placement gave it, never the bus or another extension. Data and results are JSON of at most 64 KiB; a call is cancelled when the chat closes (its `signal` aborts) and times out after 30 s; a chat has at most 16 calls pending. A function that throws rejects the component's call with its message, and the chat is unaffected.
- **Lifetime:** placements belong to the session. A reload or reopen starts empty, and the extension shows them again as it loads.
- **Compiling:** the server compiles the file and what it imports (TypeScript, `.svelte`, `.svelte.ts` modules, npm packages from the extension's folder) with esbuild and Svelte's compiler, in runes mode. Each file compiles once per session and is served by content hash. Imports of `svelte` and its public subpaths resolve to the app's own instance (`extensions/shared-svelte.ts`), so components mount inside PiSpark's tree and use its theme tokens (`var(--interactive-text)` and so on).
- **Failures:** a refused path or a compile error is a notice in the chat (with file and line). A component that throws while rendering is replaced by a short line; the rest of the chat keeps working.

Folder extensions only: a component file must live inside the extension's folder, so a single-file extension that wants a view becomes a folder (`extensions/<name>/index.ts`).

## Not yet

- `ctx.ui.custom()` returns `undefined`, and `onTerminalInput`, `setEditorComponent` and theme switching are quiet no-ops, exactly as in Pi's own RPC mode. Extensions that need `custom()` check `ctx.mode === "tui"` and fall back (Pi's `custom-header` example only sets its header in `tui` mode, so it shows nothing here).
- `getEditorText` returns `""`, and autocomplete providers are not used yet.
- Session actions from commands (`newSession`, `fork`, `navigateTree`, `switchSession`, `reload`) fail visibly.
- Shortcuts and flags, expanded tool output, a `/` command menu.

## Trying it

Copy some of Pi's own examples (`node_modules/@earendil-works/pi-coding-agent/examples/extensions`) unmodified into a persona's `extensions/` folder, for example `rpc-demo`, `permission-gate`, `status-line`, `widget-placement`, `entry-renderer`, `message-renderer`, `structured-output` and `hello`, and start a chat with that persona. Try `/rpc-input`, `/rpc-editor`, `/rpc-prefill`, `/status-card done`, `/status warn disk`, or ask for `sudo echo hi` to see the permission gate.

## Trust

Extensions run in the server process with the user's permissions. Their terminal text reaches the browser only as styled spans (links limited to http/https). Their Svelte components run in the PiSpark page, as trusted as the extension's server code: only extensions the chat's persona enables are loaded, only files inside their folders are compiled, and nothing is claimed as isolated.

## Views: how the conversation is drawn, and how to replace a part of it

The conversation is not a fixed set of components. It is a list of **segments** (`chat-turns.ts`), and each is drawn by the **view** registered for its kind, through the calls in `features/workspace/views.svelte.ts`. PiSpark's own views register through the same calls, which is how an extension's component takes a part over (the hosting layer that loads such components is not built yet; this is the contract it plugs into).

- `registerSegmentView(kind, component)` draws segments of a kind. The component gets `{ segment, sessionId }` and nothing else: no transport, no session client. The built-in kinds are `text`, `thinking`, `activity`, `custom`, `summary`, `diff`, `image`, `svg`, `notice` and `stopped`; registering one of them replaces PiSpark's view. An extension defines kinds of its own by naming them `name:kind` (for example `charts:bar`); a segment carries whatever data its view needs next to its `kind` and `key`.
- `registerToolView(tool, view)` says what a tool's calls contribute: `describe(call)` (the words, "Editing demo.ts" then "Edited demo.ts"), optionally `group` and `summarize(calls)` (how calls of that group read in an activity's one-line summary), `artifacts(call)` (segments worth reading in the message itself rather than inside the activity, such as a diff or a picture, of the built-in kinds or of the extension's own) and `detail` (a component for the opened call row). A view that does not say what it contributes still gets the generic diff and pictures. Tools with no view are described by their name.
- Both calls return a function that removes the registration. **The newest registration for a name wins; removing it brings the previous one back**, in any order. A view registered after the chat is on screen redraws it.
- For a tool's result the order is: the extension's web view, then its terminal rendering (`renderCall` / `renderResult`, shown by the default detail), then PiSpark's default.

PiSpark's defaults for Pi's own tools are in `tool-views.ts` and `default-views.ts`. A view only ever receives data PiSpark already sends the browser: the call's arguments, its result item (text, image references and Pi's `details`) and its status.
