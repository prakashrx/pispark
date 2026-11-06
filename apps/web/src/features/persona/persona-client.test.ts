import { afterEach, expect, test, vi } from "vitest";
import { PersonaClient } from "./persona-client.svelte";
import type { PersonaView } from "../../../../server/src/persona-protocol";
const reference = {
  root: "managed",
  path: "10000000-0000-4000-8000-000000000001",
  id: "10000000-0000-4000-8000-000000000001",
};
function view(name = "Writer", revision = "a".repeat(64)): PersonaView {
  return {
    ref: reference,
    definition: { schemaVersion: 1, id: reference.id, name },
    revision,
    definitionRevision: revision,
    effectiveRevision: revision,
    writable: true,
    instructions: [],
    skills: [],
    excluded: [],
    diagnostics: [],
  };
}
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
afterEach(() => vi.unstubAllGlobals());

test("late durable save updates baseline without erasing a newer draft", async () => {
  let release!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/read")
        ? response(view())
        : url.endsWith("/save")
          ? new Promise<Response>((resolve) => {
              release = resolve;
            })
          : response({ personas: [] }),
    ),
  );
  const client = new PersonaClient();
  await client.select(reference);
  client.draft!.name = "Submitted";
  const pending = client.save();
  client.draft!.name = "Newer draft";
  release(response(view("Submitted", "b".repeat(64))));
  await pending;
  expect(client.draft!.name).toBe("Newer draft");
  expect(client.dirty).toBe(true);
  expect(client.view!.revision).toBe("b".repeat(64));
});
test("409 retains draft/revision and an explicitly declined discard never reads another persona", async () => {
  const mock = vi.fn(async (url: string) =>
    url.endsWith("/read")
      ? response(view())
      : response(
          { error: "revision-conflict", requestId: "fixture-request" },
          409,
        ),
  );
  vi.stubGlobal("fetch", mock);
  vi.stubGlobal("confirm", () => false);
  const client = new PersonaClient();
  await client.select(reference);
  client.draft!.name = "Retain";
  await client.save();
  expect(client.editorError).toContain("revision-conflict");
  expect(client.draft!.name).toBe("Retain");
  expect(client.view!.revision).toBe("a".repeat(64));
  const before = mock.mock.calls.length;
  await client.select({ ...reference, path: "other" });
  expect(mock.mock.calls.length).toBe(before);
});
test("late read cannot overwrite later selection and file completion cannot update another persona revision", async () => {
  let release!: (r: Response) => void;
  let reads = 0;
  const other = {
    ...reference,
    path: "10000000-0000-4000-8000-000000000002",
    id: "10000000-0000-4000-8000-000000000002",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/read")
        ? ++reads === 1
          ? new Promise<Response>((resolve) => {
              release = resolve;
            })
          : response({
              ...view("Other"),
              ref: other,
              definition: { ...view("Other").definition, id: other.id },
            })
        : response({ personas: [] }),
    ),
  );
  const client = new PersonaClient();
  const first = client.select(reference);
  await client.select(other);
  release(response(view()));
  await first;
  expect(client.draft!.name).toBe("Other");
  await client.fileSaved(reference, "c".repeat(64));
  expect(client.view!.revision).toBe("a".repeat(64));
  const file = client.file(reference, "rules.md");
  file.content = "Unsaved";
  expect(client.hasUnsavedFiles).toBe(true);
  expect(client.file(reference, "rules.md").content).toBe("Unsaved");
});

test("bounded owned-file drafts fail visibly without losing dirty entries; late file revision cannot replace newer definition state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/read") ? response(view()) : response({ personas: [] }),
    ),
  );
  const client = new PersonaClient();
  await client.select(reference);
  for (let i = 0; i < 32; i++)
    client.file(reference, `${i}.md`).content = `Draft ${i}`;
  const blocked = client.file(reference, "overflow.md");
  expect(blocked.blocked).toBe(true);
  expect(blocked.error).toContain("limit");
  expect(client.file(reference, "0.md").content).toBe("Draft 0");
  client.view = { ...client.view!, revision: "b".repeat(64) };
  await client.fileSaved(reference, "c".repeat(64), "a".repeat(64));
  expect(client.view.revision).toBe("b".repeat(64));
});

test("an editor draft changed during a pending read is retained instead of replaced", async () => {
  let release!: (r: Response) => void,
    reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ++reads === 1
        ? response(view())
        : new Promise<Response>((resolve) => {
            release = resolve;
          }),
    ),
  );
  const client = new PersonaClient();
  client.items = [reference, { ...reference, path: "other" }].map((ref) => ({
    ref,
    name: ref.path,
    writable: true,
    valid: true,
    diagnostics: [],
  }));
  await client.select(reference);
  const pending = client.select({ ...reference, path: "other" });
  client.draft!.name = "Typed while loading";
  release(response(view("Other")));
  await pending;
  expect(client.draft!.name).toBe("Typed while loading");
  expect(client.editorError).toContain("selection cancelled");
  expect(client.inspectedSummary?.ref).toEqual(reference);
});

test("file save advances only a matching before/after graph and requires reconciliation for another tab", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/read") ? response(view()) : response({ personas: [] }),
    ),
  );
  const client = new PersonaClient();
  await client.select(reference);
  client.draft!.name = "Keep local draft";
  await client.fileSaved(
    reference,
    "b".repeat(64),
    "a".repeat(64),
    "a".repeat(64),
  );
  expect(client.view!.revision).toBe("b".repeat(64));
  await client.fileSaved(
    reference,
    "d".repeat(64),
    "b".repeat(64),
    "c".repeat(64),
  );
  expect(client.view!.revision).toBeUndefined();
  expect(client.editorError).toContain(
    "The file was saved, but this persona changed elsewhere",
  );
  expect(client.draft!.name).toBe("Keep local draft");
});

test("late create rejection cannot replace a newer selected editor error", async () => {
  let reject!: (error: Error) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/create")
        ? new Promise<Response>((_, fail) => {
            reject = fail;
          })
        : url.endsWith("/read")
          ? response(view())
          : response({ personas: [] }),
    ),
  );
  const client = new PersonaClient();
  const pending = client.create("Pending");
  await client.select(reference);
  client.editorError = "New editor diagnostic";
  reject(new Error("Delayed creation failure"));
  await pending;
  expect(client.editorError).toBe("New editor diagnostic");
  expect(client.draft!.name).toBe("Writer");
});

test("created persona during draft edit is a success notice; selection and next operation clear it without losing the draft", async () => {
  let release!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/create")
        ? new Promise<Response>((r) => {
            release = r;
          })
        : url.endsWith("/read")
          ? response(view())
          : url.endsWith("/validate")
            ? response(view())
            : response({ personas: [] }),
    ),
  );
  const client = new PersonaClient();
  await client.select(reference);
  const pending = client.create("New saved persona");
  client.draft!.name = "Keep current edits";
  release(response(view("New saved persona")));
  await pending;
  expect(client.notice).toBe(
    "Persona created. Your current edits are still here. Choose the new persona from the list when you’re ready.",
  );
  expect(client.editorError).toBe("");
  expect(client.draft!.name).toBe("Keep current edits");
  await client.validate();
  expect(client.notice).toBe("");
  await client.select(reference, true);
  expect(client.notice).toBe("");
});

test("late creation success does not attribute a notice to a newer editor", async () => {
  let release!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/create")
        ? new Promise<Response>((r) => {
            release = r;
          })
        : url.endsWith("/read")
          ? response(view())
          : response({ personas: [] }),
    ),
  );
  const client = new PersonaClient();
  const pending = client.create("New persona");
  await client.select(reference);
  release(response(view("New persona")));
  await pending;
  expect(client.notice).toBe("");
  expect(client.draft!.name).toBe("Writer");
});

test("checking a newer effective graph refreshes preview context without promoting the save baseline", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/validate")
        ? response(view("Checked", "b".repeat(64)))
        : response(view()),
    ),
  );
  const client = new PersonaClient();
  await client.select(reference);
  const loaded = client.effective;
  client.draft!.name = "Checked";
  await client.validate();
  expect(client.effective).not.toBe(loaded);
  expect(client.effective!.revision).toBe("b".repeat(64));
  expect(client.view!.revision).toBe("a".repeat(64));
  expect(client.dirty).toBe(true);
});

test("collection pauses definition/files and reopening same draft performs no read or Ask selection", async () => {
  const mock = vi.fn(async (url: string) =>
    url.endsWith("/read") ? response(view()) : response({ personas: [] }),
  );
  vi.stubGlobal("fetch", mock);
  const client = new PersonaClient();
  await client.open(reference);
  client.selected = "independent Ask persona";
  client.draft!.name = "Paused draft";
  client.file(reference, "rules.md").content = "File draft";
  client.collection();
  expect(client.mode).toBe("collection");
  await client.refresh(); // Catalog changes must not replace the held draft.
  const before = mock.mock.calls.length;
  await client.open(reference);
  expect(mock.mock.calls.length).toBe(before);
  expect(client.mode).toBe("editor");
  expect(client.draft!.name).toBe("Paused draft");
  expect(client.file(reference, "rules.md").content).toBe("File draft");
  expect(client.selected).toBe("independent Ask persona");
});

test("collection navigation supersedes pending read/create without discarding paused draft", async () => {
  let release!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/create")
        ? new Promise<Response>((r) => (release = r))
        : url.endsWith("/read")
          ? response(view())
          : response({ personas: [] }),
    ),
  );
  const client = new PersonaClient();
  await client.select(reference);
  const pending = client.create("Created", "Description");
  client.collection();
  release(response(view("Created")));
  await pending;
  expect(client.mode).toBe("collection");
  expect(client.draft!.name).toBe("Writer");
  expect(client.notice).toBe("");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Promise<Response>((r) => (release = r))),
  );
  const reading = client.select({ ...reference, path: "other" });
  client.collection();
  release(response(view("Late")));
  await reading;
  expect(client.mode).toBe("collection");
  expect(client.draft!.name).toBe("Writer");
  expect(client.reading).toBe(false);
});

test("pausing an in-flight save still installs its actual durable baseline without changing collection intent", async () => {
  let release!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/read")
        ? response(view())
        : url.endsWith("/save")
          ? new Promise<Response>((r) => (release = r))
          : response({ personas: [] }),
    ),
  );
  const client = new PersonaClient();
  await client.select(reference);
  client.draft!.name = "Saved while paused";
  const saving = client.save();
  client.collection();
  release(response(view("Saved while paused", "b".repeat(64))));
  await saving;
  expect(client.mode).toBe("collection");
  expect(client.dirty).toBe(false);
  expect(client.view!.revision).toBe("b".repeat(64));
});

test("creating supported description is real and failed creation keeps editor and draft unchanged", async () => {
  const mock = vi.fn(async (url: string) =>
    url.endsWith("/read")
      ? response(view())
      : response({ error: "storage" }, 500),
  );
  vi.stubGlobal("fetch", mock);
  const client = new PersonaClient();
  await client.select(reference);
  expect(await client.create("New", "Ordinary description")).toBe(false);
  const call = mock.mock.calls.find(([url]) => url.endsWith("/create"))!;
  expect(
    JSON.parse(String((call as unknown as [string, RequestInit])[1].body))
      .definition.description,
  ).toBe("Ordinary description");
  expect(client.draft!.name).toBe("Writer");
  expect(client.editorError).toContain("storage");
});

test("separate file save invalidates only the matching current preview; explicit check and reload restore actual freshness", async () => {
  let contents = "Old file";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/read") || url.endsWith("/validate")
        ? response({
            ...view(),
            instructions: [
              {
                id: "file",
                text: contents,
                origin: reference,
                routes: [],
                replaced: [],
              },
            ],
          })
        : response({ personas: [] }),
    ),
  );
  const client = new PersonaClient();
  await client.select(reference);
  const baseline = client.savedJSON;
  expect(client.checkedJSON).toBe(baseline);
  contents = "Updated file";
  await client.fileSaved(
    { ...reference, path: "another" },
    "new",
    "a".repeat(64),
    "a".repeat(64),
  );
  expect(client.checkedJSON).toBe(baseline);
  await client.fileSaved(
    reference,
    "b".repeat(64),
    "a".repeat(64),
    "a".repeat(64),
  );
  expect(client.checkedJSON).toBe("");
  expect(client.savedJSON).toBe(baseline);
  expect(client.effective!.instructions[0]!.text).toBe("Old file");
  await client.validate();
  expect(client.effective!.instructions[0]!.text).toBe("Updated file");
  expect(client.checkedJSON).toBe(baseline);
  expect(client.view!.revision).toBe("b".repeat(64));
  await client.select(reference, true);
  expect(client.checkedJSON).toBe(client.savedJSON);
});

test("explicit sidebar intent is consumed once; ordinary route reentry always opens collection", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(view())),
  );
  const client = new PersonaClient();
  await client.open(reference, true);
  client.enterRoute();
  expect(client.mode).toBe("editor");
  client.enterRoute();
  expect(client.mode).toBe("collection");
});

test("per-persona file work uses the full cached reference and includes busy-only drafts without changing global guards", async () => {
  const otherRoot = { ...reference, root: "other-root" };
  const otherId = { ...reference, id: "10000000-0000-4000-8000-000000000002" };
  const otherPath = { ...reference, path: "other-path" };
  const mock = vi.fn(async () => response(view()));
  vi.stubGlobal("fetch", mock);
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  const client = new PersonaClient();
  await client.select(reference);
  const dirty = client.file(reference, "rules.md");
  dirty.content = "Retained text";
  const busy = client.file(otherRoot, "rules.md");
  busy.busy = true;
  expect(busy.dirty).toBe(false);
  expect(client.hasUnsavedFilesFor(reference)).toBe(true);
  expect(client.hasUnsavedFilesFor(otherRoot)).toBe(true);
  expect(client.hasUnsavedFilesFor(otherId)).toBe(false);
  expect(client.hasUnsavedFilesFor(otherPath)).toBe(false);
  expect(client.hasUnsavedFiles).toBe(true);
  dirty.baseline = dirty.content;
  expect(client.hasUnsavedFilesFor(reference)).toBe(false);
  expect(client.hasUnsavedFiles).toBe(true); // Busy work still protects leaving globally.
  const before = mock.mock.calls.length;
  await client.select(otherId);
  expect(confirm).toHaveBeenCalledWith(
    "Leave unsaved instruction file text? Your file drafts will stay here.",
  );
  expect(mock.mock.calls.length).toBe(before);
  expect(client.view!.ref).toEqual(reference);
  busy.busy = false;
  expect(client.hasUnsavedFilesFor(otherRoot)).toBe(false);
  expect(client.hasUnsavedFiles).toBe(false);
});

test("per-persona file query does not allocate, fetch, evict or alter revisions and the 32-draft capacity", async () => {
  const mock = vi.fn();
  vi.stubGlobal("fetch", mock);
  const client = new PersonaClient();
  const clean = client.file(reference, "clean.md");
  clean.revision = "file-baseline";
  for (let i = 0; i < 31; i++)
    client.file(reference, `${i}.md`).content = `Draft ${i}`;
  const allocate = vi.spyOn(client, "file");
  for (let i = 0; i < 40; i++) {
    expect(
      client.hasUnsavedFilesFor({ ...reference, root: `unknown-${i}` }),
    ).toBe(false);
  }
  expect(client.hasUnsavedFilesFor(reference)).toBe(true);
  expect(allocate).not.toHaveBeenCalled();
  expect(mock).not.toHaveBeenCalled();
  expect(client.file(reference, "clean.md")).toBe(clean);
  expect(clean.revision).toBe("file-baseline");
  clean.content = "Now dirty";
  expect(client.file(reference, "overflow.md").blocked).toBe(true);
  for (let i = 0; i < 31; i++)
    expect(client.file(reference, `${i}.md`).content).toBe(`Draft ${i}`);
  expect(client.hasUnsavedFiles).toBe(true);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test("continuous resolution coalesces to one active and one newest snapshot without promoting management revision", async () => {
  const requests: {
    definition: { name: string };
    gate: ReturnType<typeof deferred<Response>>;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/validate")) {
        const gate = deferred<Response>();
        requests.push({
          definition: JSON.parse(String(init!.body)).definition,
          gate,
        });
        return gate.promise;
      }
      return response(view());
    }),
  );
  const client = new PersonaClient();
  await client.select(reference);
  const baseline = client.savedJSON;
  client.draft!.name = "First";
  const checking = client.validate();
  client.draft!.name = "Skipped";
  void client.validate();
  client.draft!.name = "Latest";
  void client.validate();
  expect(requests).toHaveLength(1);
  requests[0]!.gate.resolve(response(view("First", "b".repeat(64))));
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  expect(client.effective!.definition.name).toBe("Writer");
  expect(requests[1]!.definition.name).toBe("Latest");
  requests[1]!.gate.resolve(response(view("Latest", "c".repeat(64))));
  await checking;
  expect(client.resourcesCurrent).toBe(true);
  expect(client.effective!.definition.name).toBe("Latest");
  expect(client.view!.revision).toBe("a".repeat(64));
  expect(client.savedJSON).toBe(baseline);
  expect(client.resolving).toBe(false);
});

for (const action of ["file", "reload", "collection", "other"] as const) {
  test(`late validation success/error cannot restore freshness across ${action} context even with identical JSON`, async () => {
    for (const failure of [false, true]) {
      const gate = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (url.endsWith("/validate")) return gate.promise;
          if (url.endsWith("/read"))
            return response({
              ...view(),
              ref: JSON.parse(String(init!.body)).ref,
            });
          return response({ personas: [] });
        }),
      );
      const client = new PersonaClient();
      await client.select(reference);
      const checking = client.validate();
      if (action === "file")
        await client.fileSaved(
          reference,
          "b".repeat(64),
          "a".repeat(64),
          "a".repeat(64),
        );
      if (action === "reload") await client.select(reference, true);
      if (action === "collection") {
        client.collection();
        await client.open(reference);
      }
      if (action === "other")
        await client.select({ ...reference, root: "other" }, true);
      const effective = client.effective,
        checked = client.checkedJSON;
      client.editorError = "New context diagnostic";
      gate.resolve(
        failure
          ? response({ error: "resource-conflict" }, 409)
          : response(view("Too late")),
      );
      await checking;
      expect(client.effective).toBe(effective);
      expect(client.checkedJSON).toBe(checked);
      expect(client.resolutionError).toBe("");
      expect(client.editorError).toBe("New context diagnostic");
    }
  });
}

test("composition resolution requested while saving is drained for latest draft without losing durable baseline", async () => {
  const saved = deferred<Response>(),
    checked = deferred<Response>();
  const mock = vi.fn(async (url: string) =>
    url.endsWith("/save")
      ? saved.promise
      : url.endsWith("/validate")
        ? checked.promise
        : url.endsWith("/read")
          ? response(view())
          : response({ personas: [] }),
  );
  vi.stubGlobal("fetch", mock);
  const client = new PersonaClient();
  await client.select(reference);
  client.draft!.name = "Submitted";
  const saving = client.save();
  client.draft!.name = "Newest";
  void client.validate();
  expect(
    mock.mock.calls.filter(([url]) => url.endsWith("/validate")),
  ).toHaveLength(0);
  saved.resolve(response(view("Submitted", "b".repeat(64))));
  await saving;
  await vi.waitFor(() => expect(client.resolving).toBe(true));
  expect(client.view!.revision).toBe("b".repeat(64));
  expect(JSON.parse(client.savedJSON).name).toBe("Submitted");
  expect(client.draft!.name).toBe("Newest");
  checked.resolve(response(view("Newest", "c".repeat(64))));
  await vi.waitFor(() => expect(client.resourcesCurrent).toBe(true));
  expect(client.view!.revision).toBe("b".repeat(64));
});

test("read-only resolution error leaves last authoritative resources inspectable and local draft repairable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/validate")
        ? response({ error: "resource-conflict" }, 409)
        : response(view()),
    ),
  );
  const client = new PersonaClient();
  await client.select(reference);
  const effective = client.effective;
  client.draft!.instructions = [{ id: "conflict", text: "Repair me" }];
  await client.validate();
  expect(client.resolutionError).toContain("resource-conflict");
  expect(client.resourcesCurrent).toBe(false);
  expect(client.effective).toBe(effective);
  expect(client.draft!.instructions[0]!.text).toBe("Repair me");
});

test("unchanged child source failure revokes freshness and explicit retry preserves every held baseline and draft", async () => {
  const source = { ...reference, root: "source" };
  const document = (text: string, revision = "a".repeat(64)): PersonaView => ({
    ...view("Writer", revision),
    definition: {
      ...view().definition,
      parents: [{ ...source, include: { instructions: ["selected"] } }],
      instructions: [{ id: "legacy", file: "rules.md" }],
    },
    instructions: [
      { id: "selected", text, origin: source, routes: [source], replaced: [] },
    ],
  });
  let checks = 0;
  const fetch = vi.fn(async (url: string) =>
    url.endsWith("/validate")
      ? ++checks === 1
        ? response({ error: "missing-resource" }, 409)
        : response(document("Updated source text", "b".repeat(64)))
      : response(document("Original source text")),
  );
  vi.stubGlobal("fetch", fetch);
  const client = new PersonaClient();
  await client.select(reference);
  const file = client.file(reference, "rules.md");
  file.loaded = true;
  file.revision = "file-revision";
  file.baseline = "Saved file text";
  file.content = "Unsaved file text";
  client.promptMemory = {
    key: `${JSON.stringify(reference)}/legacy`,
    value: "Read text",
    state: {
      stage: "edit",
      readText: "Read text",
      editor: "Private edit",
      scroll: 12,
      readScroll: 8,
    },
  };
  const effective = client.effective,
    loaded = client.view,
    draft = client.draft,
    baseline = client.savedJSON,
    json = JSON.stringify(client.draft),
    fileJSON = JSON.stringify(file),
    prompt = client.promptMemory,
    promptJSON = JSON.stringify(prompt);
  const expectHeldState = () => {
    expect(client.view).toBe(loaded);
    expect(client.view!.revision).toBe("a".repeat(64));
    expect(client.savedJSON).toBe(baseline);
    expect(client.draft).toBe(draft);
    expect(JSON.stringify(client.draft)).toBe(json);
    expect(client.dirty).toBe(false);
    expect(client.file(reference, "rules.md")).toBe(file);
    expect(JSON.stringify(file)).toBe(fileJSON);
    expect(client.promptMemory).toBe(prompt);
    expect(JSON.stringify(client.promptMemory)).toBe(promptJSON);
    expect(client.hasUnappliedContent).toBe(true);
    expect(client.hasUnsavedFiles).toBe(true);
  };
  expect(client.resourcesCurrent).toBe(true);
  await client.validate();
  expect(checks).toBe(1);
  expect(client.resolutionError).toContain("missing-resource");
  expect(client.checkedJSON).toBe("");
  expect(client.resourcesCurrent).toBe(false);
  expect(client.effective).toBe(effective);
  expect(client.effective!.instructions[0]!.text).toBe("Original source text");
  expectHeldState();
  await client.validate();
  expect(checks).toBe(2);
  expect(client.resolutionError).toBe("");
  expect(client.checkedJSON).toBe(json);
  expect(client.resourcesCurrent).toBe(true);
  expect(client.effective!.instructions[0]!.text).toBe("Updated source text");
  expect(client.effective!.revision).toBe("b".repeat(64));
  expectHeldState();
  expect(
    fetch.mock.calls.filter(([url]) => !url.endsWith("/validate")),
  ).toHaveLength(1);
});

test("old source failure cannot revoke a reloaded identical child's newer checked context or queued retry", async () => {
  const old = deferred<Response>(),
    retry = deferred<Response>();
  let reads = 0,
    checks = 0;
  const document = (text: string): PersonaView => ({
    ...view(),
    instructions: [
      {
        id: "source",
        text,
        origin: { ...reference, root: "source" },
        routes: [],
        replaced: [],
      },
    ],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/validate")
        ? ++checks === 1
          ? old.promise
          : retry.promise
        : response(document(++reads === 1 ? "Old source" : "Reloaded source")),
    ),
  );
  const client = new PersonaClient();
  await client.select(reference);
  const json = client.savedJSON;
  const checking = client.validate();
  await client.select(reference, true);
  expect(client.savedJSON).toBe(json);
  expect(client.resourcesCurrent).toBe(true);
  const effective = client.effective,
    loaded = client.view;
  void client.validate();
  old.resolve(response({ error: "old-source-failure" }, 409));
  await vi.waitFor(() => expect(checks).toBe(2));
  expect(client.resourcesCurrent).toBe(true);
  expect(client.checkedJSON).toBe(json);
  expect(client.resolutionError).toBe("");
  expect(client.effective).toBe(effective);
  retry.resolve(response(document("Retried source")));
  await checking;
  expect(client.resourcesCurrent).toBe(true);
  expect(client.checkedJSON).toBe(json);
  expect(client.resolutionError).toBe("");
  expect(client.effective!.instructions[0]!.text).toBe("Retried source");
  expect(client.view).toBe(loaded);
  expect(client.savedJSON).toBe(json);
});

test("unapplied dialog text is separate from definition/file dirty state and discard guards protect it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(view())),
  );
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  const client = new PersonaClient();
  await client.select(reference);
  client.promptMemory = {
    key: "add",
    value: "",
    state: {
      stage: "add",
      readText: "",
      editor: "Private",
      scroll: 0,
      readScroll: 0,
    },
  };
  expect(client.hasUnappliedContent).toBe(true);
  expect(client.dirty).toBe(false);
  expect(client.hasUnsavedFiles).toBe(false);
  await client.select({ ...reference, root: "other" });
  expect(client.view!.ref).toEqual(reference);
  expect(confirm).toHaveBeenCalledWith("Discard unapplied prompt changes?");
  client.promptMemory.state!.editor = "";
  expect(client.hasUnappliedContent).toBe(false);
});
