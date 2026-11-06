# Local sessions: configuration and protocol

[VISION.md](../VISION.md) is authoritative. Pi owns execution/tools/context/extensions/history. PiSpark hosts the local runtime, commands and observation; the browser is not its owner. See [runtime details and limitations](session-runtime.md).

## Operator setup

Without configuration, `npm start` serves the real UI, health and an empty configuration catalog. Run is unavailable: no fixture model is selected and no terminal Pi installation/store is read. Native provider discovery/status can use normal server-process environment or cloud configuration; this does not enable sessions without an admitted workspace/resource configuration. `HOST` accepts only `127.0.0.1` or `::1`. This is a **trusted single-user local service**, not an authenticated remote deployment. Do not forward its port, put it behind a public proxy, or share it with untrusted local users.

Set `PISPARK_CONFIG` to an **absolute path to a trusted operator-owned ESM module**, exporting a `RuntimeConfiguration` as default. The module executes with full Node/OS privileges, like an admitted extension. Never obtain its path or source from a browser. Put private configuration outside version control; secrets belong in the native store or an explicit server secret resolver, never this repository, browser storage, model picker or host metadata. Native sign-in accepts transient secret responses. Node does not automatically load `.env` here.

Example (replace paths, inspect the native provider's available IDs, and explicitly select the model you intend to pay for):

```js
// operator-config.mjs, in a private directory with access to the pinned npm dependencies
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
export default {
  storageDir: '/absolute/private/pispark-history',
  workspaces: { project: '/absolute/project' },
  configurations: {
    'My explicit model': {
      provider: () => openaiProvider(),
      modelId: 'REPLACE_WITH_AN_ID_FROM_openaiProvider().getModels()',
      credential: { secretRef: 'project-model' },
      systemPrompt: 'Help with the explicitly selected workspace.',
      tools: ['read'],
      extensions: [], instructions: [], skills: [],
    },
  },
  resolveSecret: async reference => reference === 'project-model'
    ? process.env.PISPARK_MODEL_API_KEY : undefined,
};
```

This is an illustrative operator configuration, not a test provider or automatically enabled account. Use an absolute Windows path where applicable. The module's npm imports must resolve to the pinned installation (for example an operator-managed directory beneath the checkout with its own ignore rule, or explicit file-URL imports to the installed dependency). Do not put secrets in the module. The runtime validates the selected model, exact admitted resource files and backend workspace before execution. Native tools are cwd-bound, **not filesystem-confined**. Configuration/workspace keys (up to64 each,128 characters/key) are the browser's choices, not arbitrary browser-supplied host paths. [Local persona instruction/skill composition](personas.md) is implemented. Styles, remote/multi-user hosting, marketplace and extension Svelte hosting are deferred. Native provider OAuth is implemented through the browser bridge.

### Required runtime security gate

All production startup fails conservatively before native provider auth-resolution/availability on an unknown/vulnerable **Node-bundled** undici version, including unconfigured/local-only startup. Removing the deny-ambient adapter means Pi may consult host credentials during availability checks; a static-only unsafe-runtime mode is not provided. Supported fixed branches are stable `>=6.29.1 <7`, `>=7.30.1 <8`, or `>=8.12.2`; later stable majors pass this known-advisory gate, not a perpetual-security claim. Old majors and prereleases fail closed. The error includes actual Node/bundled undici versions. Inspect with `node -p "JSON.stringify(process.versions)"`. No waiver flag exists. The npm override does not patch Node fetch/WebSocket. Node22.23.4 / bundled undici6.29.1 is the current validated baseline; historical22.23.2/6.28.0 is unsafe and refused. Trusted code is not sandboxed; even `allowNetwork:false` does not promise that native credential checks/commands perform no I/O.

The union of affected ranges for GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c, GHSA-4w7w-5xrc-9h26, GHSA-2m5v-pch6-74hx, GHSA-qrxm-fqhp-jwvm, GHSA-9fm3-97px-rjf6 and GHSA-55wc-3pg8-jfw6 is `>=4.0.0 <6.29.1`, `>=7.0.0 <7.30.1`, `>=8.0.0 <8.12.2`. Older unsupported branches are also refused. Review newly published advisories before deployment. Residual minimatch and development findings remain documented in [development](development.md#dependency-findings); this is not an audit-clean claim.

Development: `npm run dev` admits the exact Vite origin `http://127.0.0.1:5173` and proxies with the backend Host. For another development origin explicitly set `PISPARK_DEV_ORIGIN` (literal loopback HTTP origin); set `PISPARK_API_TARGET` for Vite's backend address. No CORS grant is emitted. Production has no extra allowed origin by default. Non-browser local clients may omit Origin; browsers must obey same-origin JSON requests. Host must match the actual local listener port. Cross-site Fetch Metadata, `Origin: null`, foreign origins/hosts, non-JSON mutations, compressed and oversized requests are rejected.

## Version1 wire contract

Types: `apps/server/src/protocol.ts`, `provider-protocol.ts` and `persona-protocol.ts`. Persona management has its [own bounded operation table](personas.md#http-management). Browser-independent HTTP JSON plus SSE; no arbitrary extension EventBus, tool, credential-read, resource-loading or native-file RPC.

| Endpoint | Meaning |
| --- | --- |
| `GET /api/catalog` | Admitted workspace/resource-configuration keys; no credential references or secrets |
| `GET /api/sessions` | At most256 stored summaries; `truncated` explicitly signals more |
| `POST /api/commands` | Exact typed JSON command, UUID `commandId`; HTTP202 correlated receipt |
| `GET /api/receipts/:commandId` | Current accepted/settled receipt;404 `unknown-receipt` after expiry/restart or unknown ID |
| `GET /api/sessions/:uuid/events` | SSE `snapshot` events: initial boundary followed by replacement windows |
| `GET /api/sessions/:uuid/window?before=N` | Bounded older window in current native context, not a durable history cursor |

Commands: `create {workspace,configuration,model?,persona?}`, `open/cancel/stop {sessionId}`, `start/steer/follow-up {sessionId,text}`. All require `commandId`; unknown fields are rejected. Optional persona selection is `{root,path,id,revision}` for saved resources only; it is independent of model and host policy. Session summaries expose admitted persona identity/name/revisions, not full resources. Optional `title` is bounded chat content (one line, at most80 Unicode code points). The first accepted start input of an empty, never-started chat supplies a normalized fallback before dispatch; later inputs do not overwrite a present title. The native PiSpark integration tool can update it during ordinary agent execution; see [the session-bound capability](session-runtime.md#built-in-pispark-session-integration). There is no background naming model request or history backfill, and titles are not operational log fields. Optional `hasHistory` projects the existing host metadata fact without reading transcripts; an absent field is not evidence of an empty chat. Older v1 metadata without titles remains valid. Untitled saved chats show **Untitled chat**, truly empty chats **New chat**, with dates as secondary context. Shared sidebar/header presentation observes title changes immediately. Chat info shows only Persona, Model, Working folder and Started, not UUIDs, revisions, queues or projection constants. Example:

```json
{"commandId":"e4e803d2-72f3-4b3b-855b-a64814f18e43","type":"start","sessionId":"4f964eb2-43fa-4122-8b48-c81ea576c978","text":"Read the project overview."}
```

202 means **accepted for dispatch**, not successful model execution. A receipt settles with outcome completed/cancelled/failed/queued/handled and safe error code; create supplies the new session ID when settled. Start settlement follows the real SDK completion promise. A command wait timeout does not prove that noncooperative work stopped or ownership was released. Cancellation clears queues and is cooperative, not rollback. Stop unloads with native extension cleanup; open restores history but never restarts a prompt.

Retained command IDs are deduplicated (different payload with same ID is invalid). Ordinary commands have at most256 receipts and16 pending. Cancel/stop use a separate bounded reserve of32 receipts and16 pending, so ordinary saturation cannot disable lifecycle controls. Concurrent controls of the same type/session coalesce to the canonical receipt returned in the202 response; poll its returned `commandId`, not the proposed duplicate ID (no unbounded alias registry). Lifecycle floods can exhaust their own reserve, not ordinary admission. All settled receipts expire10 minutes after settlement. Active receipts are not evicted. Admission fails rather than forgetting retained outcomes. Receipts are memory-only: after restart/expiry **unknown does not mean unexecuted**. Never blindly retry a side-effectful command. Inspect session/history and make a deliberate new request. Ask/reply clear only the unchanged submitted draft revision, retaining newer edits (including edits away and back). Command failures remain associated with their originating session across selection changes; connectivity/configuration notifications are explicitly workspace-wide. The UI never automatically resends commands; it reports uncertain acceptance with correlation ID. Receipt polling is separate from observation so coalescing cannot erase a run's terminal result while retained.

## Snapshot continuity and bounds

The runtime registers the observer and reads the initial window synchronously. Every event includes session UUID, sequence and initial/update boundary. Subsequent snapshots are complete replacement windows, not token deltas. SDK listeners only invalidate; HTTP pulls at most10 windows/sec/connection, coalescing intermediate invalidations. Sequences increase within live ownership, reset on reopen/restart and are **not** SSE replay IDs. Every connection/reconnection begins with a fresh initial snapshot; do not compare it to a previous connection's sequence. Browser disconnect only releases observation.

Projection visits at most20 native messages plus partial output,16 content parts/message,4096 characters/field and24000 content characters total. `truncated`, `before` and `total` are explicit. Oversized content is clipped, images omitted and arbitrary tool arguments/details never serialized. Earlier windows replace one bounded older window in the UI rather than accumulating a second conversation. Window indices refer to current native context; compaction may change them. Full native JSONL remains private and canonical; there is no full-content download endpoint or durable token log. Native system/custom messages may have no displayable content. Text is escaped by Svelte, never rendered as raw HTML.

Limits:72KiB request body (64KiB prompt),5s body read,32 in-flight HTTP operations,16 SSE connections total,256KiB output/frame,2s blocked-write deadline,60s SSE lifetime with resnapshot reconnect; normal executable admits64 sockets and10s request/header deadlines. A stalled writer holds at most one serialized frame and one latest runtime invalidation, not an event backlog, and is closed if it does not drain. The pull-based browser decoder bounds incomplete frames/chunks and replaces snapshots, keeps at most32 unsent reply drafts of65536 characters, and retries only observation after2s. Raw native conversation memory/disk and trusted SDK/tool allocations are not bounded by transport limits. Sessions listing currently scans native host metadata before limiting output; huge operator-managed stores need a future indexing/retention design, not remote exposure.

## Verification and remaining limits

`session-http.test.ts` exercises real SDK concurrency, cancel/queues, snapshot race/reconnect, Host/Origin/JSON/identity, safe failures, retained IDs, expired receipts, history reopen, observer admission, large histories,10000 token events and deliberately blocked writes. Existing runtime tests cover process-kill interruption/no tool replay, auth/model/resource/storage failures and native extension cleanup. Browser tests start a **test-only executable** under `apps/server/test/fixtures/` with the actual SDK and deterministic provider. It is not imported by production source or switched on by a production flag. Browser tests exercise development proxy and production assets using shared chrome, actual start/stream/tool/reply/cancel/reconnect, independent drafts and extension errors. No external or paid provider calls were made. External auth/network streaming/cancellation compatibility, independent review and user visual acceptance remain separate gates. Native deterministic store tests do not certify real login or model entitlement.

## Providers & models: native store and browser bridge

A catalog-enabled resource configuration is independent of model choice:

```js
export default {
  storageDir: '/absolute/private/pispark/sessions',
  providerSettings: {
    directory: '/absolute/private/pispark/providers',
    modelsPath: null, // or an explicit readable absolute models.json file
  },
  workspaces: { project: '/absolute/project' },
  configurations: {
    'Project resources': {
      credential: { stored: true }, systemPrompt: 'Help with this workspace.',
      tools: ['read'], extensions: [], instructions: [], skills: [],
    },
  },
  resolveSecret: async () => undefined,
};
```

Replace paths for the backend OS. No terminal Pi setup is required. Default storage is `~/.pispark/sessions`; omitted `providerSettings.directory` is `<storageDir>/provider-settings`. The settings directory contains native `auth.json`, host `installation.json` (device identity), host `settings.json` (default model), and its ownership directory/lock. With an explicit models file, native `models-store.json` is explicitly located in that settings directory. With `modelsPath:null` (or omitted), model configuration is disabled and Pi1.4 uses an in-memory model cache: `modelsStorePath` is ignored by that native branch. Per-session model runtimes use no models file and an in-memory catalog with the resolved selection. Resources/settings and native JSONL history remain explicit session-owned paths, not terminal defaults.

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
