# Session runtime foundation

[VISION.md](../VISION.md) remains authoritative. Pi owns execution, tools, context, compaction, extensions and JSONL history. PiSpark owns session identity, persona resolution, admissions, observation and orderly teardown.

This is a **client-independent runtime**, now owned by the local HTTP entry point. See [setup, bounded HTTP/SSE protocol and UI](session-protocol.md). There is no configuration file; each chat's setup comes from its [persona](personas.md). Remote discovery and extension Svelte hosting remain deferred.

## Entry point and ownership

`apps/server/src/runtime/session-runtime.ts` exports `SessionRuntime`, configuration types and safe `RuntimeError` codes.

Construct one owner with a `RuntimeConfiguration` whose only required field is `home`, the data folder. Chats live in `<home>/chats`, personas in `<home>/personas`, providers in `<home>/providers`. Tests may also pass `fixedModel` (a keyless loopback provider) and `providerSettings` (extra native providers, a models file); production never sets them.

A chat's setup is its persona resolved into one Pi configuration: instructions appended to Pi's system prompt, skill folders, prompt templates (`/commands`), extension files, active tools and settings (model preference, thinking level). The resolved active tool list is passed explicitly on every start and reopen, so a persona edit plus reload takes effect even when the transcript recorded an earlier tool set. Models come from Providers & models: ProviderSettings selects a native provider/model and independent session ModelRuntimes use the explicit native authPath with Pi's normal auth/refresh semantics. A changed catalog model fails closed until settings are refreshed; changed defaults never alter an active session. Trusted provider/extension code can bypass these policies; this is **not a sandbox**.

Every session gets a separate `ModelRuntime`, `SettingsManager`, `ResourceLoader`, native extension runtime/EventBus, AgentSession and SessionManager. No process environment or working-directory switching. Settings are in memory with project trust explicitly false; cache warming, install telemetry and automatic retry are off. Native compaction remains Pi-owned. Explicit tools are cwd-bound but not filesystem-confined: read/write/shell and extension code carry host OS permissions. Admit only reviewed local code/tools/workspaces.

## Runtime API

| Method | Meaning |
| --- | --- |
| `create({ folder, model?, persona? })` | Reserve a live slot, check the absolute folder exists, resolve the persona (Default when omitted), choose the model, initialize/bind native extensions, return the session document. Unknown request fields are rejected. |
| `open(id)` | Reopen a known chat's native history (or an empty session) with its persona resolved now. Never accepts a session-file path. Never prompts/replays tools. |
| `reload(id)` | Stop an idle chat and open it again, so persona changes apply. Busy while running. |
| `list()` | Stored metadata summaries, including empty/unloaded sessions and interrupted status. |
| `session(id)` | The chat's session document: status, model, queue, safe error and what extensions show; no history. |
| `items(id, {before?, after?, limit?})` / `image(id, itemId, part)` / `text(id, itemId, part, offset)` | Finalized items on Pi's active branch read straight from the session, bounded by count and bytes; an image's bytes; a chunk of a clipped text part. Pi's entry ids are the cursors. |
| `liveDoc(id)` | The live document: the session document, the items not yet saved (including the message being written) and what running tools reported. |
| `observeLive(id)` | A per-connection live view (the document of unpersisted items and session state, diffed into operations on each tick) plus the invalidation iterator that says when to ask it. |
| `start(id, text)` | Send a prompt to an idle chat; returns `{ completion }`, which resolves to completed/cancelled/failed, not just acceptance. If a run slot is free the run starts now (the active marker is saved before execution); otherwise the chat is `queued` and the prompt is saved in `chat.json` until a slot frees. |
| `queue(id, text, 'steer' or 'follow-up')` | Native queued-input hooks/semantics; resolves queued/handled or rejects busy when cancelled/superseded. Only while running, one input admission in flight. |
| `cancel(id)` | A queued prompt leaves the queue. A run: prevent new inputs, clear both queues, abort/drain, clear again after outstanding input hooks. Cooperative; cannot undo tool effects. |
| `stop(id)` | Stop admissions, abort/drain, await native `session_shutdown`, flush settings, dispose, release owner. History remains. |
| `shutdown()` | Stop new sessions/inputs and drain all live sessions, including pending initialization. |

A host-owned final native input handler and `agent_before_settle` handler associate pending queue preparation with its originating run. Settlement closes new admission and waits for that run’s already admitted preparation; Pi then rechecks its native queues. Cancelled preparation rejects explicitly without appending or deleting unrelated entries. Extension-originated inputs are not host RPC admissions. A stalled trusted hook retains ownership until it actually returns; deadlines still report timeout.

Start input goes through Pi's normal prompt handling: persona prompt templates expand as `/commands` and extension commands run, as in terminal Pi. Native command-context new/switch/fork/tree/reload operations throw unsupported. Resource expansion requested by extensions also throws; additional resources require host admission. Native extension hooks, tools, bus events and lifecycle remain available. No arbitrary EventBus channel is exposed to clients.

Failures use safe codes, not raw provider/extension stacks. Items and session documents never carry SDK error diagnostics or stacks. This is not a general DLP guarantee: trusted tools/extensions and model output can contain sensitive filesystem data. Native JSONL is private server-side data and may include raw provider errors; never serve it as an unauthenticated static asset.

## Run slots

At most `maxRunning` chats (default 8) have an agent working at once (`runtime/run-slots.ts`). Further prompts wait in order with status `queued` and `queued: true` in the summary; the session document carries the waiting `queuedText`. A run whose extension waits for a person (an open `ctx.ui` question) gives its slot to the next chat. When the question is answered or gives up, the run needs a slot to go on and goes ahead of prompts that have not started; meanwhile it reports `queued: true`. Cancelling or stopping a chat that waits for a slot ends the wait at once.

## Observation and limits

Observers pull invalidations; SDK listeners never invoke subscribers, perform disk I/O, or copy/serialize transcripts. This matters because Pi emits `message_end` before native persistence. A slow observer retains **one latest invalidation**, not a growing token-event queue. Re-read the live document to render the complete current state, including partial output. Sequence gaps mean coalescing, not lost durable conversation. Sequence numbers are scoped to one live owner, not durable replay cursors; reopening/restarting begins a new observation lifetime. Closing an observer does not stop the session. Creating the live view and registering its subscription is synchronous and has no interleaving gap.

Defaults: 8 live sessions (including starting/stopping), 16 observers per session, 8 pending native inputs, 64KiB UTF-8 input, 32 exact files per resource category, 64MiB maximum native file on open, 10-second operation/cleanup wait, 5-minute cooperative run deadline. Live-session and deadline limits are trusted host options. History has no disk quota or retention manager. The live document and items are bounded by the projection (see [protocol](session-protocol.md)).

Deadlines do not kill arbitrary JavaScript or tools. If an extension ignores cancellation or shutdown hangs, the operation reports timeout and **retains ownership/admission** until actual cleanup completes. CPU-blocking trusted code can stall every same-process session. Strong adversarial isolation would require another approved design. A session with execution/storage error rejects new starts; inspect it, stop and reopen deliberately rather than automatically retry side effects.

## Persistence and recovery

Each chat owns `<home>/chats/<id>/`: a small `chat.json` (working folder, persona ID, model, created time, optional title, active/interruption markers and the setup fingerprint), Pi's native JSONL transcript, and an optional `persona/` folder once the persona is edited inside the chat. The chat ID is the folder name. Personas are read live: nothing is copied into the chat. When any persona changes, open chats compare a fingerprint of their resolved setup with the one recorded at start and report `personaChanged`; reload applies it. Setup-only chats keep `chat.json` because Pi does not write JSONL until the first message.

The host marks activity before model/tool execution. On reopen, unfinished activity is reported as interrupted; native finalized messages/context are restored without resuming an old request. Tokens and queues are not durable. A crash may lose partial assistant/tool output; a tool side effect may have happened without a finalized result. **No exactly-once guarantee and no automatic replay.** User-driven continuation is a new request and can perform new effects. Extension startup runs normally on reopen, so trusted extensions must reconstruct state without repeating side effects themselves.

One server per data folder is enforced by `<home>/pispark.lock`; a lock whose process is gone is replaced. Within the server, a chat has at most one live owner. Local single-host storage only: no NFS/distributed locking guarantee. Symlink session directories/history files are refused. Native files with missing expected history, bad header/JSON or an unsupported format fail closed instead of silently starting a new session. Corrupt trailing bytes are not automatically repaired. Neither host metadata nor native history promises fsync/power-loss atomicity.

## Explicit Pi compatibility adaptations

Pinned `@earendil-works/pi-coding-agent` and `pi-ai` **1.5.0** require Node **22.23.4+** on the supported22 branch (other supported majors also undergo the bundled-undici gate). The integration contains two deliberately narrow compatibility debts:

1. The package root exports ambient extension discovery, but not its explicit loader. Resolve the installed package entry, verify version 1.5.0/function shape, and call its native internal `loadExtensions` with the exact extension paths the persona resolves to and the real cwd. No copied loader and no ambient fallback. No project/home resource discovery.
2. `session-runtime.ts` uses the typed but **INTERNAL** Pi 1.5.0 `prompt.preflightResult("started")` boundary to reassert cancellation after input/auth preflight resets native abort state and before provider dispatch. Native `agent_start` honors the abort before its first request. Pi may record an empty assistant error for this pre-dispatch abort; the host reports cancellation rather than a new provider failure. Run identity preserves cancellation across preparation. Because native pre-start preparation can compact prior history, an instance-local wrapper on the owned runtime's public `stream`/`streamSimple` chains the public request `transformHeaders`: it awaits the SDK/extension transform, checks cancellation, then returns those headers unchanged. Pi invokes this after native auth resolution and immediately before provider dispatch. It survives native provider recomposition without re-registering a composed provider or duplicating auth/header logic; all other options and the signal are retained. Rejected dispatch uses an AbortError handled by native ModelRuntime’s lazy stream; compaction/recovery cannot bypass host cancellation. This adds no private import or execution loop. Already dispatched work retains native cooperative signal semantics. This does not undo prior effects or prevent already executing trusted input/`before_agent_start` hooks from performing their own effects.

Provider auth/catalog integration uses only public `ModelRuntime.create({authPath, modelsPath, modelsStorePath})`, login/logout/refresh/status APIs. The pinned root does not export AuthStorage; the SDK constructs its own store from authPath. There is no private auth-storage/models-store import, literal credential wrapper or internal model-collection replacement/proxy. The public stream-method wrapper above is an explicit owned-instance adaptation, not a claim of zero adaptation. Trusted extensions can still replace methods or issue their own requests; this is not isolation from backend code.

Extensions get Pi's `rpc` mode with a real UI context; see [extensions](extensions.md). Upstream explicit-loader exports and a stable cancellable-prompt boundary would remove these debts. SDK upgrades require revisiting the adapter and real-extension tests; do not silently loosen isolation to follow upstream defaults.

## Built-in PiSpark session integration

Every created/reopened hosted session, with or without a persona, loads `src/extensions/pispark.ts` first through the existing explicit native module loader (source `.ts`, compiled `.js`). It is an ordinary Pi extension, not a persona resource, title-only framework or terminal installation. A persona extension that registers the reserved `pispark_set_title` tool fails session setup instead of silently shadowing it.

The native tool accepts only `title:string` and asks for a short meaningful name when the topic is clear or meaningfully changes. A structured `before_agent_start` addition preserves existing prompts and advertises guidance only while the tool is active. The active tool list is the persona's enabled built-in tools plus every tool loaded extensions register (this one included), minus tools the persona switched off. A persona with no built-in tools still gets the title tool. The resolved list applies on every start and reopen. Trusted extensions can subsequently change tools/prompts; there is no forced-tool policy or sandbox.

The tool names the session with Pi's own `pi.setSessionName`, so there is no PiSpark-specific channel: Pi records the name in the transcript and emits `session_info_changed`, and the runtime saves that name as the chat title. Any extension's `pi.setSessionName` renames the chat the same way.

Titles are bounded to 4096 UTF-16 units of input, normalized to one printable line and capped at 80 Unicode code points; an empty or unprintable title is a tool error. The runtime writes the title to `chat.json` before showing it; a closing or cancelled chat keeps its current title, and a failed save leaves the title unchanged and says so in the chat. Operational logs omit titles and arguments; native tool arguments naturally remain in that session's Pi history. No historical scan, migration, separate paid naming pass or guarantee that every model invokes the tool is implied.

## Evidence and remaining gates

`apps/server/test/session-runtime.test.ts` uses the real pinned SDK with a deterministic **in-process local test provider**, ordinary native extension files and actual cwd-bound tools. It covers simultaneous sessions, in-flight output, cancel/queue races, native lifecycle/headless failures, empty/native history, duplicate ownership, a killed child after a tool result, no replay, ambient-resource sentinels and explicit auth probes, storage failures and timeout ownership retention. The local provider is not a fake replacement AgentSession, but it is also **not an external hosted-provider/network certification**.

External paid-provider execution was not performed. Provider-specific auth/streaming compatibility, real network cancellation and Node's bundled fetch security remain separate validation gates. See [dependency findings](development.md#dependency-findings). The [HTTP integration](session-protocol.md) keeps loopback binding, validates Host/Origin, accepts only host keys/UUIDs, separates command acceptance/settlement, bounds client output and maps invalidations without pretending they are a durable replay log. No publication/remote deployment is implied by runtime tests.

## Native provider settings ownership

Provider settings live in `<home>/providers`, covered by the data folder lock. They supply explicit auth and model-cache paths to Pi, validates native `getError()` and refresh outcomes, and fails model admission on configuration/composition/cache errors rather than silently accepting built-in endpoints. Errors returned to clients are sanitized codes. An explicit models file must be readable; malformed configuration fails startup/refresh. A failed refresh disables new selection until a successful repair/refresh or restart. Existing sessions retain their chosen model; changed defaults apply only to new catalog-enabled sessions. Removed/unavailable saved defaults stay visible, never silently replaced.

Shutdown stops settings admission first and drains admitted default writes, refresh and logout before shutting down. HTTP waits are bounded to15 seconds but a timeout does not cancel or prove failure of the operation; inspect status before retrying. Noncooperative native work can keep shutdown waiting indefinitely. Session shutdown starts independently, even if provider cleanup fails or hangs. Auth cancellation uses Pi's native abort semantics: it may stop waiting while trusted provider code continues; native locks/signals guard credential persistence, not arbitrary hook side effects. A credential can be committed before synchronization fails; login/logout report that partial outcome, never serialize its credential/cause. No forced teardown or rollback is claimed.
