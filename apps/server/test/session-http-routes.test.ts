import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { httpFixture } from "./fixtures/http-host.js";
import { eventually } from "./fixtures/local-provider.js";
import { writeAgent } from "./fixtures/home.js";
import { say } from "./fixtures/verbs.js";
import type { Item, Receipt } from "../src/contract/protocol.js";

/** A one-pixel PNG, as an ordinary Pi extension's tool returns a picture. */
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PICTURE = `
export default function (pi) {
  pi.registerTool({
    name: "picture",
    label: "Picture",
    description: "Returns a picture",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "image", data: "${PIXEL}", mimeType: "image/png" }], details: undefined };
    },
  });
}
`;
/** Waits for a condition the server answers asynchronously. */
async function until(check: () => Promise<boolean>, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("Condition did not become true");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const SERVER = `node -e "console.log('ready on 5173'); setInterval(() => console.log('tick'), 50)"`;

/** A POST whose status matters, not only its acceptance. */
const send = (base: string, path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(body) });

test("rename, seen and configure are commands; configure and answer are checked exactly", async (t) => {
  const f = await httpFixture(t);
  const id = await f.create("a");
  const command = (body: Record<string, unknown>) => send(f.base, "/api/commands", { commandId: randomUUID(), ...body });

  assert.equal((await f.settle(await f.post({ type: "rename", sessionId: id, title: "Release notes" }))).outcome, "completed");
  assert.equal(f.runtime.list().find((s) => s.id === id)?.title, "Release notes");
  assert.equal((await command({ type: "rename", sessionId: id, title: "   " })).status, 400);
  assert.equal((await f.settle(await f.post({ type: "seen", sessionId: id }))).outcome, "completed");

  // A change of thinking applies at once while the session is idle, to a level the model offers.
  const level = f.runtime.session(id).thinking!.levels.at(-1)!;
  const configured = await f.settle(await f.post({ type: "configure", sessionId: id, thinking: level }));
  assert.equal(configured.outcome, "completed");
  assert.equal(f.runtime.session(id).thinking?.level, level);
  // Nothing to change, or a field it does not know, is refused before anything runs.
  assert.equal((await command({ type: "configure", sessionId: id })).status, 400);
  assert.equal((await command({ type: "configure", sessionId: id, thinking: "low", extra: 1 })).status, 400);

  // An answer names its session and question by id and carries text, yes/no or nothing.
  const dialogId = randomUUID();
  for (const bad of [
    { type: "answer", sessionId: id, dialogId: "nope", value: true },
    { type: "answer", sessionId: id, dialogId, value: { yes: true } },
    { type: "answer", sessionId: id, dialogId, value: "x".repeat(70 * 1024) },
    { type: "answer", sessionId: id, dialogId, value: true, extra: 1 },
    { type: "answer", sessionId: id, value: true },
  ])
    assert.equal((await command(bad)).status, 400, JSON.stringify(bad).slice(0, 80));
  // A well-formed answer to a question that is not open settles as failed, and says why.
  const answered: Receipt = await f.settle(await f.post({ type: "answer", sessionId: id, dialogId, value: null }));
  assert.equal(answered.outcome, "failed");
  assert.equal(answered.error, "not-found");
});

test("processes over HTTP: every running one, a session's, its output after a point, and stopping one", async (t) => {
  const f = await httpFixture(t);
  f.provider.automatic = true;
  const id = await f.create("a");
  const started = await f.settle(await f.post({ type: "start", sessionId: id, text: say("start_process", { command: SERVER, title: "dev server" }) }));
  assert.equal(started.outcome, "completed");

  const running = await (await fetch(`${f.base}/api/processes`)).json();
  const [process] = running.processes;
  assert.equal(process.title, "dev server");
  assert.equal(process.sessionId, id);
  const listed = await (await fetch(`${f.base}/api/sessions/${id}/processes`)).json();
  assert.deepEqual(listed.processes.map((p: { id: string }) => p.id), [process.id]);
  await until(async () => !!(await (await fetch(`${f.base}/api/sessions/${id}/processes/${process.id}/output?since=0`)).json()).text?.includes("tick"));

  assert.equal((await fetch(`${f.base}/api/sessions/${id}/processes/${process.id}/stop`, { method: "POST", headers: { Origin: f.base } })).status, 202);
  await until(async () => (await (await fetch(`${f.base}/api/sessions/${id}/processes`)).json()).processes[0].state === "stopped", 10_000);
  // Another session's process, or a session that is not one, is not found.
  assert.equal((await fetch(`${f.base}/api/sessions/${randomUUID()}/processes/${process.id}/output`)).status, 400);
  assert.equal((await fetch(`${f.base}/api/sessions/not-a-session/processes`)).status, 404);
});

test("routines over HTTP: listed off, switched on, refused a switch that is not yes or no, and run now", async (t) => {
  const f = await httpFixture(t);
  f.provider.automatic = true;
  await writeAgent(f.home, "scout", { name: "Home Scout", home: "listings", routines: [{ id: "morning", name: "Morning check", cron: "0 7 * * *", prompt: "check the new listings" }] });
  await until(async () => (await (await fetch(`${f.base}/api/routines`)).json()).routines.length === 1);
  const [routine] = (await (await fetch(`${f.base}/api/routines`)).json()).routines;
  assert.equal(routine.on, false);
  assert.equal((await send(f.base, "/api/routines/scout/morning", { on: "yes" })).status, 400);
  const on = await (await send(f.base, "/api/routines/scout/morning", { on: true })).json();
  assert.equal(on.on, true);
  const run = await send(f.base, "/api/routines/scout/morning/run", {});
  assert.equal(run.status, 202, await run.clone().text());
  await eventually(() => f.runtime.list().some((s) => s.agent.id === "scout"));
});

test("a picture a tool returned is served by its part, as inert bytes", async (t) => {
  const f = await httpFixture(t, { "extensions/picture.mjs": PICTURE });
  f.provider.automatic = true;
  const id = await f.create("a");
  assert.equal((await f.settle(await f.post({ type: "start", sessionId: id, text: "tool:picture:{}" }))).outcome, "completed");
  const items: Item[] = (await (await fetch(`${f.base}/api/sessions/${id}/items`)).json()).items;
  const result = items.find((item) => item.role === "toolResult" && item.parts.some((part) => part.type === "image"))!;
  const part = result.parts.findIndex((p) => p.type === "image");
  const response = await fetch(`${f.base}/api/sessions/${id}/items/${result.id}/parts/${part}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /^sandbox; default-src 'none'/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(PIXEL, "base64"));
  // A part that is not a picture, or not there, is not served as one.
  assert.notEqual((await fetch(`${f.base}/api/sessions/${id}/items/${result.id}/parts/99`)).status, 200);
});

test("notification test and pending need the device's push endpoint", async (t) => {
  const f = await httpFixture(t);
  const endpoint = "https://fcm.googleapis.com/fcm/send/device";
  assert.equal((await send(f.base, "/api/notifications/test", {})).status, 400);
  assert.equal((await send(f.base, "/api/notifications/pending", {})).status, 400);
  assert.deepEqual(await (await send(f.base, "/api/notifications/pending", { endpoint })).json(), { notifications: [] });
  assert.equal((await send(f.base, "/api/notifications/nothing", { endpoint })).status, 404);
});
