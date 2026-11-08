# Local sessions: setup and protocol

[VISION.md](../VISION.md) is authoritative. Pi owns execution/tools/context/extensions/history. PiSpark hosts the local runtime, commands and observation; the browser is not its owner. See [runtime details and limitations](session-runtime.md).

## Setup

There is no configuration file. Start the server (`npm run dev` or `npm start`) and PiSpark uses its data folder: `PISPARK_HOME`, or `~/.pispark` when that isn't set. A leading `~` is expanded. On first start it creates the folder layout and a **Default** persona with Pi's built-in tools (`read, bash, edit, write, grep, find, ls`), so a new chat can work with files right away. Sign in to a provider under **Providers & models** and choose a model.

```text
<data folder>/
├── pispark.lock         one server per data folder
├── personas/<id>/       persona.json + instructions/, skills/, prompts/, extensions/
├── chats/<id>/          chat.json, Pi's transcript, an optional persona/ layer
├── providers/           Pi's auth.json, settings.json and model files
└── logs/
```

For development, point `PISPARK_HOME` at a separate folder in the repository's ignored `.env` (for example `PISPARK_HOME=~/.pispark-dev`) so your everyday data is never touched. A second server on the same data folder refuses to start; a lock left by a process that is gone is replaced.

Ask chooses the **working folder** (any existing folder on the backend host; defaults to the user's home, with recent folders offered), the **persona** (Default when not chosen) and the **model**. Folder paths are backend-host paths. Native tools run with the server's OS permissions and are cwd-bound, **not filesystem-confined**. Personas can enable tools, extensions and commands; see [personas](personas.md).

`HOST` accepts only `127.0.0.1` or `::1`. This is a **trusted single-user local service**, not an authenticated remote deployment. Do not forward its port, put it behind a public proxy, or share it with untrusted local users. PiSpark depends on nothing installed on the machine beyond Node: the Pi SDK is an npm dependency, and terminal Pi and `~/.pi` are never read. Styles, remote/multi-user hosting, marketplace and extension Svelte hosting are deferred.

### Required runtime security gate

All production startup fails conservatively before native provider auth-resolution/availability on an unknown/vulnerable **Node-bundled** undici version, including unconfigured/local-only startup. Removing the deny-ambient adapter means Pi may consult host credentials during availability checks; a static-only unsafe-runtime mode is not provided. Supported fixed branches are stable `>=6.29.1 <7`, `>=7.30.1 <8`, or `>=8.12.2`; later stable majors pass this known-advisory gate, not a perpetual-security claim. Old majors and prereleases fail closed. The error includes actual Node/bundled undici versions. Inspect with `node -p "JSON.stringify(process.versions)"`. No waiver flag exists. Node22.23.4 / bundled undici6.29.1 is the current validated baseline; historical22.23.2/6.28.0 is unsafe and refused. Trusted code is not sandboxed; even `allowNetwork:false` does not promise that native credential checks/commands perform no I/O.

The union of affected ranges for GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c, GHSA-4w7w-5xrc-9h26, GHSA-2m5v-pch6-74hx, GHSA-qrxm-fqhp-jwvm, GHSA-9fm3-97px-rjf6 and GHSA-55wc-3pg8-jfw6 is `>=4.0.0 <6.29.1`, `>=7.0.0 <7.30.1`, `>=8.0.0 <8.12.2`. Older unsupported branches are also refused. Review newly published advisories before deployment. Residual minimatch and development findings remain documented in [development](development.md#dependency-findings); this is not an audit-clean claim.

Development: `npm run dev` admits the exact Vite origin `http://127.0.0.1:5173` and proxies with the backend Host. For another development origin explicitly set `PISPARK_DEV_ORIGIN` (literal loopback HTTP origin); set `PISPARK_API_TARGET` for Vite's backend address. No CORS grant is emitted. Production has no extra allowed origin by default. Non-browser local clients may omit Origin; browsers must obey same-origin JSON requests. Host must match the actual local listener port. Cross-site Fetch Metadata, `Origin: null`, foreign origins/hosts, non-JSON mutations, compressed and oversized requests are rejected.

## Version1 wire contract

Types: `apps/server/src/protocol.ts`, `provider-protocol.ts` and `persona-protocol.ts`. Persona management has its [own bounded operation table](personas.md#http-management). Browser-independent HTTP JSON plus SSE; no arbitrary extension EventBus, tool, credential-read, resource-loading or native-file RPC.

| Endpoint | Meaning |
| --- | --- |
| `GET /api/catalog` | `{home, recentFolders}`: starting points for Ask's folder picker |
| `GET /api/sessions` | At most256 stored summaries; `truncated` explicitly signals more |
| `POST /api/commands` | Exact typed JSON command, UUID `commandId`; HTTP202 correlated receipt |
| `GET /api/receipts/:commandId` | Current accepted/settled receipt;404 `unknown-receipt` after expiry/restart or unknown ID |
| `GET /api/sessions/:uuid/events` | SSE `snapshot` events: initial boundary followed by replacement windows |
| `GET /api/sessions/:uuid/window?before=N` | Bounded older window in current native context, not a durable history cursor |

Commands: `create {folder,model?,persona?}`, `open/reload/cancel/stop {sessionId}`, `start/steer/follow-up {sessionId,text}`, `answer {sessionId,dialogId,value}` (a string, a yes/no or `null` to dismiss an [extension question](extensions.md)). Windows also carry `extensions` (what extensions show through Pi's `ctx.ui`), `entries` (rendered custom entries) and, per message, `index` and an optional extension `rendered` view. All require `commandId`; unknown fields are rejected. `folder` is an absolute path of an existing folder on the backend host; `persona` is a persona ID (Default when omitted). `reload` restarts an idle chat's Pi session from its transcript so persona changes apply. Session summaries expose `folder`, `persona {id,name,layered}` and, for open chats, `personaChanged` when the resolved persona no longer matches the one the session started with. Start input may be a persona `/command`; Pi expands prompt templates as in terminal Pi. Optional `title` is bounded chat content (one line, at most80 Unicode code points). The first accepted start input of an empty, never-started chat supplies a normalized fallback before dispatch; later inputs do not overwrite a present title. The native PiSpark integration tool can update it during ordinary agent execution; see [the session-bound capability](session-runtime.md#built-in-pispark-session-integration). There is no background naming model request or history backfill, and titles are not operational log fields. Optional `hasHistory` projects the existing host metadata fact without reading transcripts; an absent field is not evidence of an empty chat. Older v1 metadata without titles remains valid. Untitled saved chats show **Untitled chat**, truly empty chats **New chat**, with dates as secondary context. Shared sidebar/header presentation observes title changes immediately. Chat info shows only Persona, Model, Working folder and Started, not UUIDs, revisions, queues or projection constants. Example:

```json
{"commandId":"e4e803d2-72f3-4b3b-855b-a64814f18e43","type":"start","sessionId":"4f964eb2-43fa-4122-8b48-c81ea576c978","text":"Read the project overview."}
```

202 means **accepted for dispatch**, not successful model execution. A receipt settles with outcome completed/cancelled/failed/queued/handled and safe error code; create supplies the new session ID when settled. Start settlement follows the real SDK completion promise. A command wait timeout does not prove that noncooperative work stopped or ownership was released. Cancellation clears queues and is cooperative, not rollback. Stop unloads with native extension cleanup; open restores history but never restarts a prompt.

Retained command IDs are deduplicated (different payload with same ID is invalid). Ordinary commands have at most256 receipts and16 pending. Cancel/stop use a separate bounded reserve of32 receipts and16 pending, so ordinary saturation cannot disable lifecycle controls. Concurrent controls of the same type/session coalesce to the canonical receipt returned in the202 response; poll its returned `commandId`, not the proposed duplicate ID (no unbounded alias registry). Lifecycle floods can exhaust their own reserve, not ordinary admission. All settled receipts expire10 minutes after settlement. Active receipts are not evicted. Admission fails rather than forgetting retained outcomes. Receipts are memory-only: after restart/expiry **unknown does not mean unexecuted**. Never blindly retry a side-effectful command. Inspect session/history and make a deliberate new request. Ask/reply clear only the unchanged submitted draft revision, retaining newer edits (including edits away and back). Command failures remain associated with their originating session across selection changes; connectivity/configuration notifications are explicitly workspace-wide. The UI never automatically resends commands; it reports uncertain acceptance with correlation ID. Receipt polling is separate from observation so coalescing cannot erase a run's terminal result while retained.

## Snapshot continuity and bounds

The runtime registers the observer and reads the initial window synchronously. Every event includes session UUID, sequence and initial/update boundary. Subsequent snapshots are complete replacement windows, not token deltas. SDK listeners only invalidate; HTTP pulls at most10 windows/sec/connection, coalescing intermediate invalidations. Sequences increase within live ownership, reset on reopen/restart and are **not** SSE replay IDs. Every connection/reconnection begins with a fresh initial snapshot; do not compare it to a previous connection's sequence. Browser disconnect only releases observation. An observation request for a session with no live owner returns HTTP 410. The browser disables sending and offers to reopen it.

Each preview includes up to 20 completed messages and partial output, 16 parts per message and 4,096 UTF-16 units per part. The 24,000-unit content budget prioritizes partial output and then the newest completed messages. Roles and tool invocation identifiers have separate bounds. A clipped completed message carries an index and opaque key for paged text reads at `GET /api/sessions/:uuid/messages/:index/:key/:part/:offset`. The response includes text and an optional next cursor. The browser shows one page at a time. A changed context entry or reopened owner invalidates the key. Images and arbitrary tool arguments stay out of both projections. Pi JSONL remains canonical. The browser sanitizes assistant Markdown with an element and attribute allowlist and displays full-text pages as literal text.

Limits:72KiB request body (64KiB prompt),5s body read,32 in-flight HTTP operations,16 SSE connections total,256KiB output/frame,2s blocked-write deadline,60s SSE lifetime with resnapshot reconnect; normal executable admits64 sockets and10s request/header deadlines. A stalled writer holds at most one serialized frame and one latest runtime invalidation, not an event backlog, and is closed if it does not drain. The pull-based browser decoder bounds incomplete frames/chunks and replaces snapshots, keeps at most32 unsent reply drafts of65536 characters, and retries only observation after2s. Raw native conversation memory/disk and trusted SDK/tool allocations are not bounded by transport limits. Session listing caches host metadata across polls. Local writes update the cache immediately, external changes are reconciled every 30 seconds, and unreadable entries are counted separately from healthy chats.

## Verification and remaining limits

`session-http.test.ts` exercises real SDK concurrency, cancel/queues, snapshot race/reconnect, Host/Origin/JSON/identity, safe failures, retained IDs, expired receipts, history reopen, observer admission, large histories,10000 token events and deliberately blocked writes. Existing runtime tests cover process-kill interruption/no tool replay, auth/model/resource/storage failures and native extension cleanup. Browser tests start a **test-only executable** under `apps/server/test/fixtures/` with a temporary data folder, the actual SDK and a deterministic signed-in provider. It is not imported by production source or switched on by a production flag. Browser tests exercise development proxy and production assets using shared chrome, actual start/stream/tool/reply/cancel/reconnect, independent drafts and extension errors. No external or paid provider calls were made. External auth/network streaming/cancellation compatibility, independent review and user visual acceptance remain separate gates. Native deterministic store tests do not certify real login or model entitlement.

## Providers & models: native store and browser bridge

Model choice is independent of the persona: a new chat uses Ask's model, else the persona's preferred model (if signed in), else the default. A chat keeps its model when reopened.

`<data folder>/providers/` contains native `auth.json`, host `installation.json` (device identity), host `settings.json` (default model) and native model files. Model configuration from a `models.json` file is off by default; Pi 1.4 then uses an in-memory model cache. Per-session model runtimes use no models file and an in-memory catalog with the resolved selection. No terminal Pi setup is required or read.

`ModelRuntime.create({authPath: explicitPath, modelsPath: explicitOrNull, modelsStorePath: explicitPath})` lets Pi construct and own native locked authentication/catalog persistence. The SDK root does not export AuthStorage; PiSpark supplies a path, not a private store adapter. Separate session runtimes deliberately share the auth path, not model/session/extension state. Native OAuth refresh and errors remain Pi-owned. New runtime instances observe persisted credentials; removing credentials does not revoke already-dispatched requests or upstream grants. Native environment/cloud configuration can still make a provider available after logout. `$ENV` interpolation and credential commands are trusted operator semantics; the browser cannot upload models.json, choose config paths, or request arbitrary credential resolution.

Catalog `stored` means a native stored entry exists; `source:host` means native host configuration/ambient availability without an entry, and `source:none` means unconfigured. This is coarse metadata, not an audit of which credential wins on every request (stored entries can reference env/commands). No raw native source label or secret is returned. Configured/available **does not verify account access, subscription entitlement, quota, or connectivity**.

| Endpoint | Body/result |
| --- | --- |
| `GET /api/providers` | Safe catalog/status/default; no credentials, endpoints, headers or raw SDK errors |
| `POST /api/providers/default` | `{model:null}` or `{model:{provider,id}}`; durable default affects new catalog-enabled sessions only |
| `POST /api/providers/refresh` | `{provider}`; native catalog refresh, may use network |
| `POST /api/providers/logout` | `{provider}`; removes stored credential, not provider grant or host environment configuration |
| `POST /api/providers/auth/start` | `{provider,method}` (`api_key` or `oauth`);201 `{id,token}` |
| `POST /api/providers/auth/observe` | `{id}` plus `Authorization: Bearer <token>`; owner-only current prompt/events/state |
| `POST /api/providers/auth/respond` | `{id,prompt,value}` plus capability; preserves empty text/secret/manual responses; select values must be offered nonempty IDs |
| `POST /api/providers/auth/cancel` | `{id}` plus capability; cooperative native cancellation |

All use the existing local Host/Origin/Fetch Metadata guard, exact JSON fields and bounded admission. Mutations return200 `{ok:true}` or400 safe `{error:code}`; catalog/start/observe return their projections. Settings bodies are limited to16KiB, catalog output to2MiB, response values to8192 UTF-8 bytes; identity fields stay nonempty. Refresh/logout/default HTTP waits stop after15 seconds without cancelling the admitted operation: its result can remain uncertain and ownership is retained. Inspect status rather than blindly retrying.

Sign-in capabilities never appear in URLs, session receipts, SSE/replay, logs or browser persistent storage. Polling renews a30-second lease; deadline10 minutes; capacity8 with60-second terminal retention. Only bounded current prompts/events are retained, never submitted values. Dismissing cancels, including late starts. Native HTTPS authorization/device links open explicitly. Some methods need a browser/callback on the backend host; manual fallback appears only when Pi offers it.

Secrets necessarily transit browser form/request memory and the host/native store. They are **not encrypted at rest by PiSpark**. Protect storage/backups, the host OS account and loopback clients. A committed login followed by synchronization failure is `saved-sync-failed`; committed removal followed by failure is `removed-sync-failed`. Neither is rollback or proof retries are harmless. Malformed/unreadable model configuration, composition errors or failed cache restoration disable selection with sanitized `provider-configuration`. Repair host configuration/cache and refresh/restart rather than silently accepting built-in endpoints. Existing sessions keep their chosen model; defaults affect only new sessions. Actual execution still requires account/model access. Generic failure guidance never exposes provider payloads.
