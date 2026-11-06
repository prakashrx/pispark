# Local personas

[VISION.md](../VISION.md) is authoritative. Pi owns agent execution, native skills, tools, extensions, model/auth and canonical history. PiSpark owns editable definitions, local composition, management UI and session-owned resource admission. This milestone manages **ordered system instructions and standard skills only**. No new extension framework or skill format is involved.

## Use the management page

Open Settings → Personas → Manage personas to browse the searchable saved collection. **New persona** opens a Name/Description dialog; only a successful backend create opens its editor. The editor has one **Save changes** action and continuous **Reuse personas**, **Prompts**, **Skills** sections. Labels and content use a20/80 split on wide screens and stack on narrow screens. Its action menu holds Edit name and description, Preview, Advanced settings and Reload saved version. Sidebar Manage personas returns to the collection without clearing paused definition/file drafts; opening the same persona resumes them without a destructive reload. Choosing another persona or creating while dirty retains deliberate discard confirmation. Editor navigation never changes Ask's persona choice.

**Add prompt** opens a private text editor; confirming adds an inline draft, not a saved definition. Compact rows show short text in full and longer text with **Read full prompt**. The same dialog reads plain text, edits local prompts and customizes inherited prompts. **Apply changes** updates only the persona draft and returns to reading; Cancel returns to the original reading state without applying. Closing a changed editor asks before discarding. One current unapplied prompt dialog may be paused in memory across route/collection navigation; explicitly reopening the same target resumes it. Changing target, owner or saved context requires reconciliation/discard, never implicit application. Unapplied text has its own leave/unload protection; main Save changes does not save that private text.

**Import text** and drops into the editor accept one bounded UTF-8 text file (text MIME, or `.txt`/`.md` with no MIME). Imports become editable inline text only: no linked files, upload, attachments, path detection, PDF/image extraction or rendered HTML. Nonempty text requires explicit replacement confirmation. Unsupported/binary/empty/oversize input leaves current text intact; typing, cancel, close, owner/context change and disposal invalidate asynchronous reads. Inline prompts are limited to64KiB UTF-8 each and32 local entries; the overall128KiB serialized-definition bound still applies.

Existing stored file references remain file references, without migration or conversion. Their row can read actual known text; **Edit file** deliberately opens the existing Load file/Contents/Save file controls. **Save file is separate from Save changes**, not a transactional Save all. Legacy relative paths remain repairable in Advanced settings; the ordinary Add prompt dialog does not create linked files. Add skill accepts an existing host-relative folder containing SKILL.md, not a browser upload or discovery/install service. Operators provision skill files. Item menus own local ordering, removal and Advanced settings (reference name and replace-matching checkbox). Generated reference names stay out of ordinary authoring. External sources are read-only but readable.

**Use persona** adds saved valid personas by name. Choose what to use exposes actual prompt/skill checkboxes: all by default, explicit none or a subset. Advanced reference-name tokens retain unavailable selections and permit validated manual repair; no comma-separated fields or automatic loss of unknown IDs. Unknown references still fail composition validation. Actual resolved inherited prompts and skills appear in the lower sections, tagged with their originating persona, including transitive origins. Customize holds inherited prompt text privately until confirmed, then adds a same-ID local replacement; skill Customize asks for a deliberate folder in the child persona, adds the same reference name with `replace:true` only on confirmation, and never copies files or reuses the source's relative path automatically. Cancel leaves the definition unchanged.

Deliberate composition actions request the existing backend's read-only validation. At most one resolution is active with one replaceable latest snapshot pending; there is no per-keystroke network validation or frontend inheritance resolver. Until a matching response arrives, the page truthfully marks last-checked inherited rows stale/updating or shows an error while local drafts stay editable. Conflicts and unavailable resources remain inspectable/repairable. Preview still displays resolved order, provenance and exclusions, labelled **Saved version**, **Checked draft** or **Changes not checked**. **Check changes** validates without saving or advancing the editor's management revision. Separate file saves invalidate freshness until a new check/reload; opening Preview alone does not read resources. Advanced settings contains folder/revision facts and optional draft JSON.

Save changes waits for the backend response. A stale revision fails with `revision-conflict`; the draft is retained, with no automatic retry or overwrite. A successful separate file save advances the editor baseline only when the contributing saved graph still matches its original baseline apart from that file. Concurrent definition/parent/resource changes require deliberate reload/reconciliation; the file save and definition draft are retained. Reload deliberately discards definition edits after confirmation. Definition and owned-file drafts survive route changes in memory; page reload discards drafts after the browser's unload warning. At most32 owned-file drafts are retained; clean entries can be evicted. Rendering rows never allocates file drafts. Catalog errors retain original references and safe diagnostics, including malformed or unsupported documents without usable identities. These documents are inspectable but not reconstructed through a lossy save. A readable definition with missing/invalid resources is inspectable with diagnostics, but has no usable management revision until its inputs are repaired.

Choose a saved persona in the persistent Ask **Persona** picker, independently of Folder and Model. No persona preserves the configuration-only workflow. When multiple trusted host policies exist, Advanced → Chat setup exposes them; they are not portable persona properties. Selecting a persona never grants tools, changes credentials or changes a running agent. Saves affect **new chats only**. Chat info shows the admitted persona's name, model, working folder and human start time; exact refs/revisions remain backend metadata, not ordinary chat presentation.

Native skill advertisement requires an explicitly operator-enabled `read` or `bash` tool. With neither, the picker explains **Skills need file access, which this chat setup doesn’t allow.** The editor warns when no configured chat setup supports reading. Saving reusable skill references is still permitted. `allowed-tools` frontmatter never changes host permissions. Native `disable-model-invocation` skills are not advertised. Initial web `/skill:name` text remains literal because the existing `expandPromptTemplates:false` policy also suppresses native skill/extension/template command expansion. Native queued steer/follow-up expansion retains its existing separate behavior; this is not a new web slash-command feature.

## Storage and operator roots

The managed root defaults to `personas` beside `storageDir` (normally `~/.pispark/personas`). A development session root under `~/.pispark-dev` naturally keeps personas there. Existing configuration modules need no new field. Optional trusted configuration:

```js
personas: {
  directory: '/absolute/private/pispark/personas',
  roots: { examples: '/absolute/reviewed/local-collection' },
},
```

External roots are operator-admitted, read-only through PiSpark, and never fetched or Git-mutated. The browser cannot add roots, import configuration modules or browse arbitrary host paths. Use narrow collection roots, not a home/drive root. Managed creation generates an immutable UUID and matching folder; display-name edits do not rename identity. Canonical containment and component checks reject symlinks/junctions, path escapes, special files, absolute/drive/UNC/alternate-stream syntax and unsupported paths. These checks are **not a filesystem sandbox against hostile same-user path swaps**, trusted tools or extension code.

A persona folder contains `persona.json` and optional resource files. This portable example assumes an explicitly admitted `examples` root containing `base/` and `writer/`:

```json
{
  "schemaVersion": 1,
  "id": "10000000-0000-4000-8000-000000000001",
  "name": "Base writer",
  "instructions": [
    { "id": "tone", "text": "Be clear and concise." },
    { "id": "evidence", "file": "rules/evidence.md" }
  ],
  "skills": [{ "id": "review", "directory": "skills/review" }]
}
```

`skills/review/SKILL.md` is an ordinary Pi skill, for example:

```markdown
---
name: review
description: Review a proposed change using its supporting checklist.
---
Read references/checklist.md before reviewing.
```

Supporting files remain in the skill directory. A root-level skill (`directory: "."`) is supported: `persona.json` is itself skill support, so definition edits intentionally change its effective revision. Only the exact temporary file owned by a definition save is excluded from that operation's consistency comparison; arbitrary `.tmp` and other support files remain included. Owned instruction-file writes cannot author any skill tree. A derived definition:

```json
{
  "schemaVersion": 1,
  "id": "10000000-0000-4000-8000-000000000002",
  "name": "Friendly writer",
  "parents": [{
    "root": "examples", "path": "base",
    "id": "10000000-0000-4000-8000-000000000001",
    "include": { "instructions": ["tone", "evidence"], "skills": ["review"] }
  }],
  "exclude": { "instructions": ["evidence"] },
  "instructions": [
    { "id": "tone", "replace": true, "text": "Be concise and welcoming." },
    { "id": "closing", "text": "End with a useful next action." }
  ]
}
```

Effective order is tone, closing; review is inherited. These are portable documentation examples, not an automatically installed persona or a privileged Developer mode.

## Definition and deterministic composition

Version1 accepts exactly `schemaVersion`, immutable UUID-v4 `id`, trimmed `name` (1–120), optional `description` (1024), `parents`, `instructions`, `skills`, and `exclude`. Unknown fields/versions fail, including future extensions, tools, commands, documents, model/style preferences and MCP resources. Logical IDs match `[a-z][a-z0-9]*(?:-[a-z0-9]+)*`, at most64 characters, separately scoped to instructions and skills.

- Parent references are `{root,path,id,include?}`. The root-relative directory and expected UUID must both match. Include has optional `instructions`/`skills` ID arrays: omitted means all, `[]` means none. Resource paths resolve against their declaring persona/root, never a child or browser cwd.
- Instructions are `{id,text,replace?}` or `{id,file,replace?}` (exactly one). No template interpolation. Skills are `{id,directory,replace?}` and use the native Pi parser on exact verified SKILL.md paths, without default discovery. Native diagnostics, directory aliases and native-name collisions fail instead of using first-wins behavior.
- Resolve every parent depth-first in listed order before filtering. First occurrence allocates an ordered ID slot. The same declaring resource reached through a diamond deduplicates, retaining bounded contributing routes. Two different declarations conflict even when their bytes match.
- Exclude removes inherited slots. A local duplicate inherited ID requires `replace:true`, replacing all candidates while keeping its slot. New IDs append. Unknown includes/excludes/replacements, exclude-plus-local-readd, cycles and divergent unresolved slots fail explicitly. Joining parents may resolve their combined conflict with a local replace/exclude; an internally invalid parent never becomes valid merely by filtering it.

Hashes use version1 canonical JSON (sorted object keys, ordered arrays, UTF-8, no whitespace). `definitionRevision` hashes exact persona.json bytes; management `revision` includes all contributing definition revisions and input digests; `effectiveRevision` includes ordered effective content and provenance. File-byte changes matter. Inputs are rechecked after resolution and during admission. Repeated identical inputs yield the same revisions. Public views contain intended instruction text/declared relative paths, not internal absolute loading paths or skill support-file contents.

Writes use an exclusive per-persona directory lock shared across cooperating processes, bounded wait and explicit busy failure. Unknown/stale locks are not removed automatically; an operator must establish they are unused before repair. At most16 writes are admitted; shutdown stops new admission and drains admitted writes. A same-directory exclusive temporary file is flushed and atomically renamed, with expected revision and containment rechecks. Creates stage privately before rename. File saves have their own expected byte revision (`null` for creation), recheck the current declaration/skill ownership under the writer lock and immediately before rename, and return a post-write `revision` when resolvable. `beforeRevision` is present only when comparison proves the graph changed solely in that file. There is no cross-file transaction, filesystem CAS, external-editor lock enforcement, automatic merge or watcher. POSIX modes are not Windows ACL isolation.

### Bounds

Definitions128KiB; parents8/node, graph64 nodes/128 edges/16 levels; local32 instructions/skills; effective64 instructions/256KiB text and32 skills including host skills. Instruction files/text64KiB each, graph instruction work2MiB. One skill:256 regular files, depth8,1MiB/file,8MiB total; graph skills1024 files/32MiB. Hidden supporting files are included; `.git`/`node_modules` skill trees, links and unsupported files are rejected rather than silently omitted. Discovery:16 roots,8 directory levels,2048 entries,256 personas; exceeding a bound fails, never silently truncates a complete catalog. Reference directories512 characters/8 components; resource paths512/16,120/component. Admission supported-resource budget36MiB/session, record2MiB. Management requests/responses512KiB, catalog64 entries/page. Limits are local-service protection, not bounds on trusted tool/model/extension allocations or total history retention.

## Native admission, history and recovery

Host systemPrompt stays the native preamble; ordered persona instructions use `ResourceLoader.getAppendSystemPrompt`. Captured explicit host instruction files remain `getAgentsFiles`. Pi assembles the final prompt and advertises skills; skill bodies are not flattened into system text. Host policy, extensions, model/header/auth composition and native cancellation stay on their existing boundaries.

Persona sessions add only `persona/admission.json` and `persona/skills/...` beneath the existing session directory. `host.json`, native JSONL, `owner.lock` and `agent` locations stay unchanged. The admission record captures instruction bytes/provenance, source references/revisions, complete bounded skill copies/manifests and a host-policy fingerprint; host metadata binds its digest. Pi JSONL is the **only finalized transcript**. No upload/extension/fork stores are created.

Complete standard skill trees (including hidden support files and script modes where supported) are copied and source/copy consistency checked before commit. Configured host skills join host-first with strict collision checks. An existing configured standalone Markdown skill remains supported as an explicit single-file legacy copy; neighboring support files are not claimed captured. Native loading points at the copies.

Original source edits/removal do not change admitted resources, including after restart. Reopen checks the captured record/copies, **not original instruction/skill content**. It still checks current host policy fields/locations and explicit extension entry-file digests. Changed policy fails `configuration-changed`; missing/corrupt/version-mismatched/changed admitted copies fail `resource-integrity`, never silently rebuild or fall back to legacy. Checks run at reopen/start/queue/provider-dispatch boundaries, retaining the existing async header transform/cancellation ordering and stable errors when native stream setup settles as an error.

Copies are not immutable storage or interception of every tool read. Same-user code can mutate a copy between verification and use; skill scripts/external references/dependencies and executable extension dependency trees are not hermetic snapshots. There is no hot reload/fork or automatic repair. Snapshots grow with retained sessions. Existing version1 **no-persona sessions** keep their legacy recovery behavior without migration, transcript rewrite or a retroactive reproducibility promise. Old create requests still work.

## HTTP management

All endpoints share the existing loopback Host/Origin/Fetch Metadata guard and request admission. POST JSON has exact keys. GET is no-store. See `persona-protocol.ts` for types.

| Endpoint | Body/result |
| --- | --- |
| `GET /api/personas?cursor=N` | Up to64 summaries and optional nextCursor; invalid records have safe diagnostics |
| `POST /api/personas/read` | `{ref}`; actual definition/writability/revisions/effective view; unresolved resources omit management/effective revisions and include diagnostics |
| `POST /api/personas/validate` | `{ref?,definition}`; unsaved effective validation, no durable mutation; create the owned folder before authoring file references |
| `POST /api/personas/create` | `{definition}` without id; server UUID/folder and saved view |
| `POST /api/personas/save` | `{ref,expectedRevision,definition}`; immutable identity, validated durable save |
| `POST /api/personas/instruction/read` | `{ref,path}`; declared local instruction text/byte revision, not general file reads |
| `POST /api/personas/instruction` | `{ref,path,expectedRevision,text}`; explicit owned .md/.txt file create/save; never external/inherited/skill files |

Failures are `{error,requestId,diagnostics?}` with safe codes, no native causes/paths/content. Categories include400 schema/path/body limits,403 read-only,404 missing root/operation,409 stale/busy,422 resource/resolution/conflict errors,500 storage and503 shutdown. New session `create` adds optional `persona:{root,path,id,revision}` independently of workspace/configuration/model. Missing/stale selection fails before dispatch. Session views expose only admitted persona name/ref/revisions, not full resources. There is no delete, arbitrary file browser, root registration, Git, module execution or skill-authoring endpoint.

## Structured operational logs

Default JSONL logs are `logs` beside session storage. Optional trusted `logging:{directory:'/absolute/private/logs'}` changes the location; `logging:{console:true}` selects console JSON. No telemetry service is used. Never put operational config/logs/auth/session state in the source tree.

Events cover host/HTTP failures, persona operations, resource admission/integrity and session lifecycle. Records allow only timestamp/level/event, host-generated request/operation correlation, UUID session/persona IDs, duration, static outcome/code and bounded numeric counts. Names, paths, hashes, prompts/conversations/resource contents, headers, credentials, auth codes/links, raw causes and stacks are not fields. Follow a requestId/operationId to its failure and inspect resources locally; do not enable content logging to debug it.

One serialized writer bounds queue256 records/256KiB and record2KiB. Active file5MiB plus3 rotations (20MiB). Overflow drops new records with a bounded counter; failures drop queued work and back off60s, with at most one content-free fallback warning/minute. A stalled sink has one in-flight write and a bounded queue. Shutdown drains at most2s then discards remaining queued records. Logging failure is nonfatal. Logs and session copies require normal OS access/backup protection, not an encryption/sandbox claim.
