# Pi extensions in PiSpark

[VISION.md](../VISION.md) §2 and §7 are authoritative: extensions are ordinary Pi extensions, and web presentation is additive. PiSpark runs them unchanged. Whatever UI they use through Pi has a web counterpart where one exists; nothing PiSpark-specific is needed in the extension.

## How it works

Each chat is one Pi `AgentSession`. PiSpark binds Pi's **`rpc` mode** with its own `ExtensionUIContext` (`apps/server/src/extensions/extension-ui.ts`). That is the capability set Pi defines for clients that are not a terminal, so extensions keep using `ctx.hasUI` / `ctx.mode` as they already do. What extensions show is session state in the chat's snapshot; the browser draws it.

Extensions style text with Pi's theme. PiSpark gives them a theme whose colors stand for a few PiSpark roles (accent, success, warning, danger, muted, subtle, border, selected), turns the terminal output into styled spans on the server, and the browser draws the spans with the current PiSpark theme's tokens (`extensions/styled-text.ts`, `StyledText.svelte`). Raw terminal colors an extension picks itself pass through as colors.

Pi's terminal components are just `render(width)` → lines, so PiSpark calls an extension's own renderers on the server, with no terminal, at 80 columns (`extensions/extension-render.ts`). The browser wraps narrower views. Components get the parts of a TUI that render-only components use (its size and `requestRender`). Extension UI updates reach the browser at most every 100 ms, so animated titles and spinners stay cheap.

## Supported

| Pi API | In PiSpark |
| --- | --- |
| `ctx.ui.select`, `confirm`, `input`, `editor` | A question card above the reply box. It takes focus; arrows move between options, Enter answers, Escape dismisses, focus returns. Honours Pi's `timeout` (with a countdown) and `signal`. Cancelling or stopping the chat dismisses open questions. Questions wait while no browser is watching. |
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

## Not yet

- `ctx.ui.custom()` returns `undefined`, and `onTerminalInput`, `setEditorComponent` and theme switching are quiet no-ops, exactly as in Pi's own RPC mode. Extensions that need `custom()` check `ctx.mode === "tui"` and fall back (Pi's `custom-header` example only sets its header in `tui` mode, so it shows nothing here).
- `getEditorText` returns `""`, and autocomplete providers are not used yet.
- Session actions from commands (`newSession`, `fork`, `navigateTree`, `switchSession`, `reload`) fail visibly.
- Shortcuts and flags, expanded tool output, a `/` command menu.

## Trying it

Copy some of Pi's own examples (`node_modules/@earendil-works/pi-coding-agent/examples/extensions`) unmodified into a persona's `extensions/` folder, for example `rpc-demo`, `permission-gate`, `status-line`, `widget-placement`, `entry-renderer`, `message-renderer`, `structured-output` and `hello`, and start a chat with that persona. Try `/rpc-input`, `/rpc-editor`, `/rpc-prefill`, `/status-card done`, `/status warn disk`, or ask for `sudo echo hi` to see the permission gate.

## Trust

Extensions run in the server process with the user's permissions. Their text reaches the browser only as styled spans (links limited to http/https); no extension code runs in the browser.
