import { realpathSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { validateDefinition, PersonaError } from "../src/core/personas/format.js";
import { WOKEN_ENTRY } from "../src/contract/wake-protocol.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome } from "./fixtures/home.js";

const local = (text: string) => new Date(text).getTime();
const MORNING = { id: "morning", name: "Morning check", cron: "0 7 * * *", prompt: "check the new listings" };

async function fixture() {
  const h = await testHome("pispark-routines-");
  h.provider.automatic = true;
  await h.persona("scout", { name: "Home Scout", home: "listings", routines: [MORNING] });
  const clock = { now: local("2026-11-13T06:00") };
  const runtimes: SessionRuntime[] = [];
  const make = () => {
    const runtime = new SessionRuntime({ ...h.configuration, wakeTickMs: 0, now: () => clock.now });
    runtimes.push(runtime);
    return runtime;
  };
  return {
    ...h,
    clock,
    runtime: make(),
    make,
    runs: (runtime: SessionRuntime) => runtime.list().filter((session) => session.persona.id === "scout"),
    cleanup: async () => {
      await Promise.allSettled(runtimes.map((r) => r.shutdown()));
      await h.remove();
    },
  };
}

test("a routine is declared by its persona and checked like any definition", () => {
  assert.throws(() => validateDefinition({ name: "X", routines: [{ ...MORNING, cron: "every morning" }] }), PersonaError);
  assert.throws(() => validateDefinition({ name: "X", routines: [MORNING, MORNING] }), PersonaError);
  assert.throws(() => validateDefinition({ name: "X", routines: [{ ...MORNING, extra: 1 }] }), PersonaError);
  assert.throws(() => validateDefinition({ routines: [MORNING] }, { chatLayer: true }), PersonaError);
  assert.deepEqual(validateDefinition({ name: "X", routines: [MORNING], on: ["routine:morning", "hold:telegram"] }).routines, [MORNING]);
});

test("a routine is off until switched on; each run is a new session of its persona", async () => {
  const f = await fixture();
  try {
    let [routine] = f.runtime.listRoutines().routines;
    assert.equal(routine!.on, false);
    assert.equal(routine!.next, undefined);
    assert.deepEqual(routine!.persona, { id: "scout", name: "Home Scout", home: "listings" });

    // Off: its time passes without a run.
    f.clock.now = local("2026-11-13T07:00");
    await f.runtime.checkWakes();
    assert.equal(f.runs(f.runtime).length, 0);

    // Switched on: an ordinary switch in the persona, counting from now.
    routine = f.runtime.setRoutine("scout", "morning", true);
    assert.equal(routine.on, true);
    assert.equal(routine.next, new Date(local("2026-11-14T07:00")).toISOString());
    const persona = JSON.parse(await readFile(join(f.home, "personas", "scout", "persona.json"), "utf8"));
    assert.deepEqual(persona.on, ["routine:morning"]);

    f.clock.now = local("2026-11-14T07:00");
    await f.runtime.checkWakes();
    await eventually(() => f.runs(f.runtime).length === 1);
    const [run] = f.runs(f.runtime);
    assert.equal(run!.title, "Morning check · Sat 14 Nov");
    // The same folder, however the temporary path is spelled (Windows may give an 8.3 short name).
    assert.equal(realpathSync.native(run!.folder), realpathSync.native(join(f.home, "apps", "scout")));
    await eventually(() => f.runtime.items(run!.id, {}).items.some((item) => item.role === "assistant"));
    const woken = f.runtime.items(run!.id, {}).items.find((item) => item.customType === WOKEN_ENTRY)!;
    assert.deepEqual((woken.details as { source: unknown }).source, { kind: "schedule", id: "scout/morning", label: "Morning check · Every day at 7:00 am" });
    assert.equal(f.runtime.listRoutines().routines[0]!.runs[0]!.session, run!.id);

    // Paused: nothing starts.
    f.runtime.updateSettings({ unattendedPaused: true });
    f.clock.now = local("2026-11-15T07:00");
    await f.runtime.checkWakes();
    assert.equal(f.runs(f.runtime).length, 1);
    f.runtime.updateSettings({ unattendedPaused: false });

    // Run now works whether or not it is switched on.
    f.runtime.setRoutine("scout", "morning", false);
    await f.runtime.runRoutine("scout", "morning");
    await eventually(() => f.runs(f.runtime).length === 2);
  } finally {
    await f.cleanup();
  }
});

test("a run missed while PiSpark was off is caught up within a day, counting from the newest run", async () => {
  const f = await fixture();
  try {
    f.runtime.setRoutine("scout", "morning", true);
    f.clock.now = local("2026-11-14T07:00");
    await f.runtime.checkWakes();
    await eventually(() => f.runs(f.runtime).length === 1 && f.runs(f.runtime).every((s) => s.status === "idle"));
    await f.runtime.shutdown();

    f.clock.now = local("2026-11-15T09:00");
    const again = f.make();
    await again.checkWakes();
    await eventually(() => f.runs(again).length === 2);
    assert.equal(f.runs(again).find((s) => s.title === "Morning check · Sun 15 Nov")?.persona.id, "scout");
  } finally {
    await f.cleanup();
  }
});
