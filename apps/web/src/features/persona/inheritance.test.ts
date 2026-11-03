import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
import { afterEach, expect, test, vi } from "vitest";
import Inheritance from "./Inheritance.svelte";
import type {
  PersonaParent,
  PersonaDocument,
  PersonaSummary,
} from "../../../../server/src/persona-protocol";
const ref = { root: "managed", path: "parent", id: "parent-id" };
const doc: PersonaDocument = {
  ref,
  definition: { schemaVersion: 1, id: ref.id, name: "Base" },
  writable: true,
  definitionRevision: "rev",
  instructions: [
    { id: "one", text: "First rule", origin: ref, routes: [], replaced: [] },
    { id: "two", file: "rules.md", origin: ref, routes: [], replaced: [] },
  ],
  skills: [
    {
      id: "skill",
      nativeName: "Review",
      directory: "skills/review",
      origin: ref,
      routes: [],
      replaced: [],
    },
  ],
  excluded: [],
  diagnostics: [],
};
const options: PersonaSummary[] = [
  { ref, name: "Base", valid: true, writable: true, diagnostics: [] },
];
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function openChoices() {
  await fireEvent.click(screen.getByText("Choose what to use"));
}
test("Based on uses resource checkboxes for all, none, subset and preserves unknown selected references without refetching", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(doc)));
  vi.stubGlobal("fetch", fetch);
  const parent: PersonaParent = {
    ...ref,
    include: { instructions: ["one", "unknown"] },
  };
  render(Inheritance, {
    parents: [parent],
    options,
    selfId: "child",
    exclude: {},
  });
  await openChoices();
  const first = await screen.findByRole("checkbox", {
    name: "1 · instructions · First rule",
  });
  expect((first as HTMLInputElement).checked).toBe(true);
  const second = screen.getByRole("checkbox", {
    name: "1 · instructions · rules.md",
  });
  expect((second as HTMLInputElement).checked).toBe(false);
  await fireEvent.click(second);
  expect(parent.include?.instructions).toEqual(["one", "unknown", "two"]);
  const unknown = screen.getByRole("checkbox", {
    name: "Reference unknown · unavailable",
  });
  await fireEvent.click(unknown);
  expect(parent.include?.instructions).toBeUndefined();
  await fireEvent.click(first);
  await fireEvent.click(second);
  expect(parent.include?.instructions).toEqual([]);
  await fireEvent.click(first);
  expect(parent.include?.instructions).toEqual(["one"]);
  expect(
    (
      screen.getByRole("checkbox", {
        name: "1 · skills · Review",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});
test("late parent reads cannot replace new reference state; unavailable parent preserves exact include fallback", async () => {
  let finish!: (r: Response) => void;
  const other = { root: "examples", path: "missing", id: "other" };
  const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
    JSON.parse(String(init?.body)).ref.id === ref.id
      ? new Promise<Response>((r) => {
          finish = r;
        })
      : new Response(
          JSON.stringify({
            error: "missing-parent",
            requestId: "safe-request",
          }),
          { status: 404 },
        ),
  );
  vi.stubGlobal("fetch", fetch);
  const parent = { ...other, include: { instructions: ["retain-me"] } };
  const rendered = render(Inheritance, {
    parents: [{ ...ref }],
    options,
    selfId: "child",
    exclude: {},
  });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await rendered.rerender({
    parents: [parent],
    options,
    selfId: "child",
    exclude: {},
  });
  await openChoices();
  await screen.findByText(
    "An instruction file or skill folder couldn’t be found.",
  );
  finish(new Response(JSON.stringify(doc)));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    screen.queryByRole("checkbox", { name: "1 · instructions · First rule" }),
  ).toBeNull();
  expect(parent.include.instructions).toEqual(["retain-me"]);
  const advanced = screen.getAllByText("Advanced")[0]!;
  await fireEvent.click(advanced);
  expect(
    (
      screen.getByRole("textbox", {
        name: "Parent 1 included instructions",
      }) as HTMLInputElement
    ).value,
  ).toBe("retain-me");
});

test("same-reference successful reload refreshes choices; unchecking old preserves newly inherited resources and does not refetch on edits", async () => {
  let current = { ...doc, instructions: doc.instructions.slice(0, 1) };
  const fetch = vi.fn(async () => new Response(JSON.stringify(current)));
  vi.stubGlobal("fetch", fetch);
  const parent: PersonaParent = { ...ref };
  const props = {
    parents: [parent],
    options,
    selfId: "child",
    exclude: {},
    loadContext: { ...doc },
  };
  const rendered = render(Inheritance, props);
  await openChoices();
  await screen.findByRole("checkbox", {
    name: "1 · instructions · First rule",
  });
  expect(
    screen.queryByRole("checkbox", { name: "1 · instructions · rules.md" }),
  ).toBeNull();
  current = doc;
  await rendered.rerender({
    ...props,
    loadContext: { ...doc, effectiveRevision: "new-graph" },
  });
  const added = await screen.findByRole("checkbox", {
    name: "1 · instructions · rules.md",
  });
  expect((added as HTMLInputElement).checked).toBe(true);
  await fireEvent.click(
    screen.getByRole("checkbox", { name: "1 · instructions · First rule" }),
  );
  expect(parent.include?.instructions).toEqual(["two"]);
  await rendered.rerender({
    ...props,
    loadContext: (props.loadContext = {
      ...doc,
      effectiveRevision: "checked-graph",
    }),
  });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  await screen.findByRole("checkbox", { name: "1 · instructions · rules.md" });
  await fireEvent.click(
    screen.getByRole("checkbox", { name: "1 · instructions · rules.md" }),
  );
  expect(parent.include?.instructions).toEqual([]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("failed parent cache retries after successful child reload and rejects late responses from an older context", async () => {
  let finish!: (r: Response) => void;
  let calls = 0;
  const fetch = vi.fn(async () => {
    calls++;
    if (calls === 1)
      return new Response(JSON.stringify({ error: "missing-parent" }), {
        status: 404,
      });
    if (calls === 2)
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    return new Response(JSON.stringify(doc));
  });
  vi.stubGlobal("fetch", fetch);
  const parent: PersonaParent = {
    ...ref,
    include: { instructions: ["one", "unknown"] },
  };
  const props = {
    parents: [parent],
    options,
    selfId: "child",
    exclude: {},
    loadContext: { ...doc },
  };
  const rendered = render(Inheritance, props);
  await openChoices();
  await screen.findByText(
    "An instruction file or skill folder couldn’t be found.",
  );
  await rendered.rerender({ ...props, loadContext: { ...doc } });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await rendered.rerender({ ...props, loadContext: { ...doc } });
  await screen.findByRole("checkbox", { name: "1 · instructions · rules.md" });
  finish(new Response(JSON.stringify({ ...doc, instructions: [] })));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    screen.getByRole("checkbox", { name: "1 · instructions · rules.md" }),
  ).toBeTruthy();
  await fireEvent.click(
    screen.getByRole("checkbox", { name: "1 · instructions · rules.md" }),
  );
  expect(parent.include?.instructions).toEqual(["one", "unknown", "two"]);
  expect(fetch).toHaveBeenCalledTimes(3);
});
