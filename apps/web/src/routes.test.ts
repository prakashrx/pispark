import { expect, test } from "vitest";
import { pageFromHash, routes } from "./routes";

test("explicit route map retains both hash spellings and safe workspace fallback", () => {
  for (const page of Object.keys(routes)) {
    expect(pageFromHash(`#/${page}`)).toBe(page);
    expect(pageFromHash(`#${page}`)).toBe(page);
  }
  for (const hash of ["", "#/missing", "#/toString", "#/__proto__"]) {
    expect(pageFromHash(hash)).toBe("workspace");
  }
});
