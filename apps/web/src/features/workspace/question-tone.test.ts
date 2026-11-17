import { expect, test } from "vitest";
import { questionTone } from "./question-tone";

test("a question's tone comes from its own words", () => {
  expect(questionTone("Dangerous command", "rm -rf ./build")).toBe("danger");
  expect(questionTone("Delete 3 files?")).toBe("danger");
  expect(questionTone("Overwrite package.json?")).toBe("warning");
  expect(questionTone("Update the snapshot files too?")).toBe("info");
  expect(questionTone("Which branch?", undefined)).toBe("info");
});
