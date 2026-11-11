import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { compileView, viewBundle } from "../src/core/extensions/view-compiler.js";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { SessionHttp } from "../src/http/session-http.js";
import { createAppServer } from "../src/http/server.js";
import { addViewExtension, testHome, viewExtension } from "./fixtures/home.js";
import { noticeText } from "./fixtures/chat.js";

const eventually = async (check: () => boolean, ms = 10_000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test("view compiler: one browser module on the page's shared Svelte, addressed by content", async () => {
  const hash = await compileView(join(viewExtension, "Counter.svelte"));
  const code = viewBundle(hash)!;
  assert.match(hash, /^[a-f0-9]{32}$/);
  // Child components are bundled in; Svelte itself comes from the page.
  assert.match(code, /Pressed here|pressed here/);
  assert.match(code, /__pisparkSvelte\["svelte\/internal\/client"\]/);
  assert.doesNotMatch(code, /from\s*["']svelte/);
  assert.match(code, /export\s*\{[^}]*default/);
  assert.equal(await compileView(join(viewExtension, "Counter.svelte")), hash, "same source, same address");
  await assert.rejects(compileView(join(viewExtension, "Broken.svelte")), /Broken\.svelte|Expected|Unexpected/);
});

test("extensions show components with Pi's bus: slots, props, calls back, entries with data, failures", async () => {
  const h = await testHome("pispark-views-");
  try {
    await h.persona("default", { name: "Default" });
    await addViewExtension(h.home, "default");
    // A component outside the extension's folder is refused.
    await writeFile(join(h.home, "personas", "default", "extensions", "Outside.svelte"), "<p>no</p>");
    h.provider.automatic = true;
    const runtime = new SessionRuntime({ ...h.configuration, callTimeoutMs: 300 });
    const chat = await runtime.create({ folder: await h.folder("work") });
    const views = () => runtime.session(chat.id).extensions.views;
    const notices = () => noticeText(runtime, chat.id);

    // Placed while the extension loaded; each shows once compiled.
    await eventually(() => views().length === 7);
    assert.deepEqual(
      views().map(({ slot, key, props }) => ({ slot, key, props })),
      [
        { slot: "reply.above", key: "counter", props: { count: 0 } },
        { slot: "reply.actions", key: "", props: { on: false } },
        { slot: "chat.title", key: "", props: { text: "fixture chip" } },
        { slot: "reply.footer", key: "", props: { text: "Fixture footer" } },
        { slot: "chat.header", key: "", props: { text: "Fixture banner" } },
        { slot: "tool:shout", key: "", props: undefined },
        { slot: "custom:note", key: "", props: undefined },
      ],
    );
    for (const { url } of views()) {
      assert.match(url, /^\/api\/views\/[a-f0-9]{32}\.js$/);
      assert.ok(viewBundle(url.slice(11, -3)), "the browser can load it");
    }
    const counterUrl = views()[0]!.url;

    // host.call runs a function of the component's own placement and gives back its result; the
    // extension shows new props at once, reusing the compiled component.
    assert.equal(await runtime.call(chat.id, "reply.above", "counter", "add", 2), 2);
    assert.deepEqual(views()[0], { slot: "reply.above", key: "counter", url: counterUrl, props: { count: 2 } });
    const code = (expected: string, detail?: RegExp) => (error: { code?: string; detail?: string }) =>
      error.code === expected && (!detail || detail.test(error.detail ?? ""));
    // The extension's own error comes back to the component; the chat is unaffected.
    await assert.rejects(runtime.call(chat.id, "reply.above", "counter", "jam"), code("extension", /The counter is jammed/));
    // A function that never answers times out; a result that is not JSON is refused.
    await assert.rejects(runtime.call(chat.id, "reply.above", "counter", "hang"), code("timeout"));
    await assert.rejects(runtime.call(chat.id, "reply.above", "counter", "notJson"), code("extension", /must be JSON/));
    // A placement reaches only its own functions: the header has no "add", the counter no "removeCounter".
    await assert.rejects(runtime.call(chat.id, "chat.header", "", "add", 1), code("not-found"));
    await assert.rejects(runtime.call(chat.id, "reply.above", "counter", "removeCounter"), code("not-found"));

    // A custom entry with a placed component reaches the browser with its data, even with no terminal renderer.
    await runtime.start(chat.id, "/note saved").completion;
    const page = runtime.items(chat.id, {});
    const note = page.items.find((item) => item.role === "entry");
    assert.deepEqual({ customType: note?.customType, details: note?.details }, { customType: "note", details: { text: "saved" } });

    // The tool call's result carries Pi's details for the tool slot.
    await runtime.start(chat.id, 'tool:shout:{"word":"hi"}').completion;
    const result = runtime.items(chat.id, {}).items.find((item) => item.role === "toolResult" && item.toolName === "shout");
    assert.deepEqual(result?.details, { loud: "HI" });

    // Removing: an event with no component.
    await runtime.call(chat.id, "chat.header", "", "removeCounter");
    assert.equal(views().some((v) => v.key === "counter"), false);

    // Refused and broken components are notices, not failures of the chat.
    await runtime.call(chat.id, "chat.header", "", "placeOutside");
    await eventually(() => notices().some((n) => /not inside an extension this chat loads/.test(n)));
    await runtime.call(chat.id, "chat.header", "", "placeBroken");
    await eventually(() => notices().some((n) => /Broken\.svelte could not be compiled/.test(n)));
    assert.equal(views().some((v) => v.key === "broken"), false);
    assert.equal(runtime.session(chat.id).error, undefined);

    await runtime.shutdown();
  } finally {
    await h.remove();
  }
});

test("host.call over HTTP is a plain request and response: many calls never block the chat", async () => {
  const h = await testHome("pispark-views-http-");
  const runtime = new SessionRuntime({ ...h.configuration, callTimeoutMs: 300 });
  const http = new SessionHttp(runtime);
  const server = createAppServer({ sessions: http });
  try {
    await h.persona("default", { name: "Default" });
    await addViewExtension(h.home, "default");
    h.provider.automatic = true;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;
    const chat = await runtime.create({ folder: await h.folder("work") });
    await eventually(() => runtime.session(chat.id).extensions.views.length === 7);
    const call = (body: unknown) =>
      fetch(`${base}/api/sessions/${chat.id}/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base },
        body: JSON.stringify(body),
      });

    // More calls than the server keeps command receipts for: each answers and is forgotten.
    for (let i = 0; i < 300; i++) {
      const response = await call({ slot: "reply.above", key: "counter", name: "add", data: 1 });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { result: i + 1 });
    }
    // The extension's own error, and a function the placement does not have.
    const jam = await call({ slot: "reply.above", key: "counter", name: "jam" });
    assert.equal(jam.status, 200);
    assert.deepEqual(await jam.json(), { error: "extension", detail: "The counter is jammed" });
    assert.equal((await call({ slot: "chat.header", key: "", name: "add" })).status, 404);
    assert.equal((await call({ slot: "reply.above", key: "counter", name: "add", extra: 1 })).status, 400);

    // Sending a message still works.
    const response = await fetch(`${base}/api/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ commandId: randomUUID(), type: "start", sessionId: chat.id, text: "hello" }),
    });
    assert.equal(response.status, 202);
    assert.equal(((await response.json()) as { error?: string }).error, undefined);
    await eventually(() => runtime.session(chat.id).status === "idle");
  } finally {
    await http.shutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await h.remove();
  }
});

test("an extension keeps its state in Pi's session: the counter survives a restart", async () => {
  const h = await testHome("pispark-views-restart-");
  const runtimes: SessionRuntime[] = [];
  const runtime = () => {
    const created = new SessionRuntime(h.configuration);
    runtimes.push(created);
    return created;
  };
  try {
    await h.persona("default", { name: "Default" });
    await addViewExtension(h.home, "default");
    h.provider.automatic = true;
    const counter = (on: SessionRuntime, id: string) =>
      (on.session(id).extensions.views.find((view) => view.key === "counter")?.props as { count?: number } | undefined)?.count;
    const first = runtime();
    const chat = await first.create({ folder: await h.folder("work") });
    // Pi writes the transcript once the chat has a reply.
    await first.start(chat.id, "hello").completion;
    for (let i = 0; i < 10; i++) await first.call(chat.id, "reply.above", "counter", "add", 1);
    await eventually(() => counter(first, chat.id) === 10, 5000);
    await first.shutdown();

    const second = runtime();
    await second.open(chat.id);
    await eventually(() => counter(second, chat.id) === 10, 5000);
    assert.equal(await second.call(chat.id, "reply.above", "counter", "add", 1), 11);
    // The saved state is not a chat item: nothing draws "counter" entries.
    assert.equal(second.items(chat.id, {}).items.some((item) => item.customType === "counter"), false);
  } finally {
    await Promise.allSettled(runtimes.map((r) => r.shutdown()));
    await h.remove();
  }
});
