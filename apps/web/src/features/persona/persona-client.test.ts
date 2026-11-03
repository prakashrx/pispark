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
  expect(client.editorError).toContain("parent graph changed");
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
