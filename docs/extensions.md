# Pi extensions in PiSpark

[VISION.md](../VISION.md) §2 and §7 are authoritative: extensions are ordinary Pi extensions, and web presentation is additive. PiSpark runs them unchanged. Whatever UI they use through Pi has a web counterpart where one exists; nothing PiSpark-specific is needed in the extension.

## How it works

Each chat is one Pi `AgentSession`. PiSpark binds Pi's **`rpc` mode** with its own `ExtensionUIContext` (`apps/server/src/core/extensions/extension-ui.ts`). That is the capability set Pi defines for clients that are not a terminal, so extensions keep using `ctx.hasUI` / `ctx.mode` as they already do. What extensions show is session state in the chat's snapshot; the browser draws it.

Extensions style text with Pi's theme. PiSpark gives them a theme whose colors stand for a few PiSpark roles (accent, success, warning, danger, muted, subtle, border, selected), turns the terminal output into styled spans on the server, and the browser draws the spans with the current PiSpark theme's tokens (`core/extensions/styled-text.ts`, `StyledText.svelte`). Raw terminal colors an extension picks itself pass through as colors.

Pi's terminal components are just `render(width)` → lines, so PiSpark calls an extension's own renderers on the server, with no terminal, at 80 columns (`core/extensions/extension-render.ts`). The browser wraps narrower views. Components get the parts of a TUI that render-only components use (its size and `requestRender`). Extension UI updates reach the browser at most every 100 ms, so animated titles and spinners stay cheap.

## Supported

| Pi API | In PiSpark |
| --- | --- |
| `ctx.ui.select`, `confirm`, `input`, `editor` | A question card above the reply box, with one frame for every kind: it takes focus (a confirmation starts on the question, not on an answer; a list starts on its filter or first option), Escape or Skip skips, focus returns afterwards, a timeout shows a countdown, and a hint line names the keys. Confirmations answer to Y and N; lists scroll inside the card, filter from eight options up, answer to 1–9 and show `label — detail` as two lines; text is submitted with Enter, an editor with Ctrl+Enter. Honours Pi's `timeout` and `signal`. Cancelling or stopping the chat dismisses open questions. Questions wait while no browser is watching; while one is open, the chat says "Waiting for you" in its header and the chat list. An answered or skipped question leaves a line in the chat ("Proceed? → no"); what a person typed is not echoed. |
| `ctx.ui.notify` | A line in the conversation where it happened; warnings and errors are labelled and tinted. Once the chat is open, notices (and the line for each answered question and failing handler) are kept in the chat's Pi session as `pispark:notice` custom entries, so they are still there after reopening or a restart and follow branches. Notices raised while a chat opens are shown only for that session. |
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

An extension shows its own Svelte component with one event on **Pi's own event bus**, from its normal `index.ts`, and gives it the functions it may call. There is no PiSpark API, manifest or second entry file. Terminal Pi has no listener for the event, so there it does nothing and the extension's terminal rendering is used.

```ts
export default function (pi) {
  let count = 0;
  const show = () =>
    pi.events.emit("pispark:view", {
      slot: "reply.above",
      component: new URL("./Counter.svelte", import.meta.url),
      props: { count },
      calls: { add: (by) => { count += by; show(); return count; } },
    });
  show();
}
```

```svelte
<script>
  let { data, host, count } = $props();
</script>

<button onclick={() => host.call("add", 1)}>Count {count}</button>
```

**One rule:** a slot is the name of something PiSpark draws. Components placed in a slot are drawn there instead of PiSpark's default, in the order they were placed; with none placed, the default shows. Show or update by emitting again; remove by leaving out `component`.

**One component shape:** every component gets `data` (what that place draws, when it has something), `host` (whose `call(name, data)` runs a function its own placement gave it and resolves with the result, or rejects with the extension's error) and the props the extension sent.

| Slot | Where | `data` | Pi's terminal equivalent |
| --- | --- | --- | --- |
| `tool:<name>` | Each call of that tool (the component is the whole call: PiSpark draws no activity line, opened row, diff or pictures for it) | the call: args, status, progress, result with Pi's `details` | `renderResult`, `registerToolRenderer` |
| `custom:<customType>` | Custom messages and entries of that type (entries are sent with their data) | the message or entry, its data as `details` | `registerMessageRenderer`, `registerEntryRenderer` |
| `chat.title` | Small things beside the chat title (chips) | — | — |
| `chat.header` | Under the chat header | — | `setHeader` |
| `reply.above`, `reply.below` | Above and below the reply box | — | `setWidget` above or below the editor |
| `reply.actions` | Small actions beside Send (toggles, buttons) | — | — |
| `reply.footer` | Under the reply box, replacing the status line | — | `setFooter` |

PiSpark owns each place's frame (chips and actions sit in a row, blocks around the reply box are spaced like widgets), and the extension owns what is inside. Thinking, answer text, summaries and notices are PiSpark's own, as they are Pi's in the terminal.

- **Event shape:** `{ slot, component, props?, calls?, key? }`. `component` is a `file:` URL (a `URL` or its string) or absolute path of a `.svelte` file inside the extension's own folder. `key` tells several placements in one slot apart. New props for the same file update the mounted component in place.
- **Calls:** `calls[name](data, { signal })` runs in the extension, in the server. A component reaches only the functions its own placement gave it, never the bus or another extension. Data and results are JSON of at most 64 KiB; a call is cancelled when the chat closes (its `signal` aborts) and times out after 30 s; a chat has at most 16 calls pending. A function that throws rejects the component's call with its message, and the chat is unaffected.
- **Lifetime:** placements belong to the session. A reload, a reopen or a restart starts empty, and the extension shows them again as it loads (see [keeping state](#keeping-state)).
- **Compiling:** the server compiles the file and what it imports (TypeScript, `.svelte`, `.svelte.ts` modules, npm packages from the extension's folder) with esbuild and Svelte's compiler, in runes mode. Each file compiles once per session and is served by content hash. Imports of `svelte` and its public subpaths resolve to the app's own instance (`contract/shared-svelte.ts`), so components mount inside PiSpark's tree and use its theme tokens (`var(--interactive-text)` and so on).
- **Failures:** a refused path or a compile error is a notice in the chat (with file and line). A component that throws while rendering is replaced by a short line; the rest of the chat keeps working.

### Keeping state

PiSpark keeps no copy of what a component showed: props are drawn from the extension's state, and that state lives where Pi keeps an extension's state, in the chat's session. Save it with `pi.appendEntry(customType, data)` when it changes (saved with the transcript, never sent to the model) and read it back on `session_start`, which Pi sends for a new chat and when a chat is resumed:

```js
let count = 0;
pi.on("session_start", (_event, ctx) => {
  const saved = ctx.sessionManager.getBranch().findLast((e) => e.type === "custom" && e.customType === "counter");
  count = saved?.data?.count ?? 0;
  show();
});
// When it changes: count++; pi.appendEntry("counter", { count }); show();
```

Because the entries are on the chat's branch, the state survives a restart, a reload or a chat being unloaded, and follows forks: a branch shows the state it had at that point. It works the same in terminal Pi. Each save is a line in the transcript, so save on a meaningful change, not many times a second. Pi writes a new chat's transcript once it has its first reply; state saved before that is kept only while the chat stays open. A preference that is not part of the chat (a collapsed panel) does not belong in the transcript; PiSpark has no store for that yet.

Folder extensions only: a component file must live inside the extension's folder, so a single-file extension that wants a view becomes a folder (`extensions/<name>/index.ts`). More places (side panel tabs, Chat info menu items) can join the catalog under the same rule.

## Not yet

- `ctx.ui.custom()` returns `undefined`, and `onTerminalInput`, `setEditorComponent` and theme switching are quiet no-ops, exactly as in Pi's own RPC mode. Extensions that need `custom()` check `ctx.mode === "tui"` and fall back (Pi's `custom-header` example only sets its header in `tui` mode, so it shows nothing here).
- `getEditorText` returns `""`, and autocomplete providers are not used yet.
- Session actions from commands (`newSession`, `fork`, `navigateTree`, `switchSession`, `reload`) fail visibly.
- Shortcuts and flags, expanded tool output, a `/` command menu.

## Trying it

Copy some of Pi's own examples (`node_modules/@earendil-works/pi-coding-agent/examples/extensions`) unmodified into a persona's `extensions/` folder, for example `rpc-demo`, `permission-gate`, `status-line`, `widget-placement`, `entry-renderer`, `message-renderer`, `structured-output` and `hello`, and start a chat with that persona. Try `/rpc-input`, `/rpc-editor`, `/rpc-prefill`, `/status-card done`, `/status warn disk`, or ask for `sudo echo hi` to see the permission gate.

## Trust

Extensions run in the server process with the user's permissions. Their terminal text reaches the browser only as styled spans (links limited to http/https). Their Svelte components run in the PiSpark page, as trusted as the extension's server code: only extensions the chat's persona enables are loaded, only files inside their folders are compiled, and nothing is claimed as isolated.

## How PiSpark draws the conversation

The conversation is a list of **segments** (`chat-turns.ts`): text, thinking, tool activity, custom messages and entries, summaries, diffs, pictures, notices. PiSpark draws each with the view registered for its kind (`features/workspace/views.svelte.ts`, defaults in `default-views.ts`), and describes tool calls with the views in `tool-views.ts` ("Editing demo.ts", then "Edited demo.ts"). This registry is PiSpark's own.

An extension takes over a part of the chat only by placing a component in its slot: `tool:<name>` replaces everything PiSpark draws for that tool's calls, and `custom:<customType>` replaces the default for its custom messages and entries. Without a component, a tool result shows the extension's terminal rendering (`renderCall` / `renderResult`) inside PiSpark's default, and otherwise PiSpark's default alone.
