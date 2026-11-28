import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { RuntimeError } from "../src/core/runtime/errors.js";
import { routeShape, statusOf } from "../src/http/io.js";

test("a failure's status says whose it was", () => {
  const status = (code: ConstructorParameters<typeof RuntimeError>[0]) => statusOf(new RuntimeError(code));
  assert.equal(status("invalid-input"), 400);
  assert.equal(status("folder"), 400);
  assert.equal(status("not-found"), 404);
  for (const code of ["busy", "owned", "read-only"] as const) assert.equal(status(code), 409, code);
  assert.equal(status("limit"), 429);
  for (const code of ["storage", "execution", "extension", "timeout", "sdk-version"] as const) assert.equal(status(code), 500, code);
  assert.equal(status("closed"), 503);
  // Anything that is not a refusal of the runtime's is the server's own failure.
  assert.equal(statusOf(new TypeError("x")), 500);
  assert.equal(statusOf(undefined), 500);
});

test("a path's shape keeps the API's words and drops every id and name", () => {
  const id = "3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b";
  assert.equal(routeShape(`/api/sessions/${id}/items/entry-9/parts/3?offset=4`), "/api/sessions/:id/items/:id/parts/:id");
  assert.equal(routeShape(`/api/sessions/${id}/attachments/My%20Secret%20Plan.pdf`), "/api/sessions/:id/attachments/:id");
  assert.equal(routeShape("/api/routines/scout/morning/run"), "/api/routines/:id/:id/run");
  assert.equal(routeShape(undefined), "/:id");
  assert.equal(routeShape(`/${"a/".repeat(40)}`).split("/").length, 13);
});

test("every path the API names is made of words the log keeps", () => {
  const http = fileURLToPath(new URL("../src/http/", import.meta.url));
  const named = readdirSync(http).flatMap((file) => {
    const source = readFileSync(`${http}${file}`, "utf8");
    const paths = [...source.matchAll(/["`](\/api(?:\/[a-z-]+)+)\/?["`]/g)].map((match) => match[1]!);
    // The agent API names its operations in a switch.
    const operations = file === "agent-http.ts" ? [...source.matchAll(/case "([a-z]+(?:\/[a-z]+)*)":/g)].map((match) => `/api/agents/${match[1]}`) : [];
    return [...paths, ...operations];
  });
  assert(named.length > 30, "the scan found the API's paths");
  for (const path of named) assert.equal(routeShape(path), path);
});
