import { expect, test } from "vitest";
import {
  personaError,
  personaName,
  resourceLabel,
} from "./persona-presentation";
const ref = { root: "managed", path: "base", id: "shared-id" };
test("plain persona errors map safe leading codes, not diagnostic resource names, without leaking codes into primary copy", () => {
  const cases = [
    ["revision-conflict", "changed elsewhere"],
    ["resource-changed", "changed elsewhere"],
    ["missing-resource", "couldn’t be found"],
    ["missing-parent", "couldn’t be found"],
    ["cycle", "depend on each other"],
    ["resource-conflict", "same reference name"],
    ["duplicate-resource", "same reference name"],
    ["skill-name-conflict", "same reference name"],
    ["unsupported-version", "format this version can’t edit"],
    ["read-only", "read-only"],
    ["path-outside-root", "isn’t available"],
    ["storage", "Couldn’t save"],
    ["limit", "too large"],
    ["busy", "workspace is busy"],
    ["closed", "workspace is busy"],
  ];
  for (const [code, message] of cases)
    expect(
      personaError(
        `${code}: instructions revision-conflict storage cycle (safe-request)`,
      ),
    ).toContain(message);
  expect(personaError("PRIVATE unexpected browser failure")).toBe(
    "Couldn’t complete that action.",
  );
  expect(personaError("invalid-definition")).toBe(
    "This persona’s file isn’t valid. Fix the original file to continue.",
  );
  expect(personaError("invalid-definition", "draft", true)).toBe(
    "Check this persona’s name, instructions, and skills.",
  );
  expect(personaError("unexpected", "draft", true)).toBe(
    "Couldn’t complete that action. Your edits are still here.",
  );
  expect(personaError("unexpected", "file", false)).not.toContain("Your edits");
  expect(personaError("storage")).not.toContain("Your edits");
  expect(personaError("storage", "file", true)).toContain(
    "Your edits are still here.",
  );
});
test("labels are bounded text and provenance matches the full canonical persona reference", () => {
  expect(
    resourceLabel({
      id: "logical",
      origin: ref,
      routes: [],
      replaced: [],
      text: "  First\tline\nSecond",
    }),
  ).toBe("First line");
  expect(
    Array.from(
      resourceLabel({
        id: "logical",
        origin: ref,
        routes: [],
        replaced: [],
        nativeName: "😀".repeat(90),
      }),
    ),
  ).toHaveLength(80);
  const options = [
    { ref, name: "Actual base", valid: true, writable: true, diagnostics: [] },
  ];
  expect(personaName(ref, options)).toBe("Actual base");
  expect(personaName({ ...ref, root: "another-root" }, options)).toBe(
    "Unavailable persona",
  );
});

test("local capacity and duplicate persona identity have distinct recovery copy", () => {
  expect(personaError("file-draft-limit", "file")).toBe(
    "Too many files have unsaved changes. Save one, then reopen this file.",
  );
  expect(personaError("duplicate-identity: managed/first managed/second")).toBe(
    "These persona files share the same identity. Fix the duplicate files to continue.",
  );
});
