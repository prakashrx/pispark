import assert from "node:assert/strict";
import test from "node:test";
import { reloads, SetupChanges } from "../src/core/runtime/setup-changes.js";

const model = (id: string) => ({ provider: "local", id });

test("changes asked for while a session works merge: the latest model and thinking win, every asker is kept", () => {
  const changes = new SetupChanges();
  changes.add("a", { model: model("one"), thinking: "low" });
  changes.add("a", { model: model("two") });
  assert.deepEqual(changes.view("a"), { model: model("two"), thinking: "low" });
  assert.equal(reloads(changes.take("a")!), false, "model and thinking alone need no reload");

  changes.add("a", { asked: "pispark_self (reload)" });
  changes.add("a", { asked: "pispark_self (reload)" });
  changes.add("a", { reload: true });
  assert.deepEqual(changes.view("a"), { reload: true });
  assert.deepEqual(changes.take("a")!.asked, ["pispark_self (reload)"]);
  assert.equal(changes.has("a"), false);
});

test("one extension revision waits at a time; what could not be applied yet goes back under newer changes", () => {
  const changes = new SetupChanges();
  assert.equal(changes.add("a", { extension: "r1", asked: "apply" }), true);
  assert.equal(changes.add("a", { extension: "r2", asked: "apply again" }), false);
  assert.equal(changes.extension("a"), "r1");
  const taken = changes.take("a")!;
  changes.add("a", { thinking: "high" });
  changes.restore("a", taken);
  assert.deepEqual(changes.take("a"), { model: undefined, thinking: "high", reload: false, extension: "r1", asked: ["apply"] });
  assert.equal(changes.view("b"), undefined);
});
