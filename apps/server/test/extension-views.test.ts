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
  const hash = await compileView(join(viewExtension, "Counter.svelte"), viewExtension);
  const code = viewBundle(hash)!;
  assert.match(hash, /^[a-f0-9]{32}$/);
  // Child components are bundled in; Svelte itself comes from the page.
  assert.match(code, /Pressed here|pressed here/);
  assert.match(code, /__pisparkSvelte\["svelte\/internal\/client"\]/);
  assert.doesNotMatch(code, /from\s*["']svelte/);
  assert.match(code, /export\s*\{[^}]*default/);
  assert.equal(await compileView(join(viewExtension, "Counter.svelte"), viewExtension), hash, "same source, same address");
  await assert.rejects(compileView(join(viewExtension, "Broken.svelte"), viewExtension), /Broken\.svelte|Expected|Unexpected/);
});

test("extensions show components with Pi's bus: points, props, calls back, entries with data, failures", async () => {
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
      views().map(({ point, key, props }) => ({ point, key, props })),
      [
        { point: "session.input.above", key: "counter", props: { count: 0 } },
        { point: "session.input.actions", key: "", props: { on: false } },
        { point: "session.title", key: "", props: { text: "fixture chip" } },
        { point: "session.status", key: "", props: { text: "Fixture footer" } },
        { point: "session.header", key: "", props: { text: "Fixture banner" } },
        { point: "item.tool:shout", key: "", props: undefined },
        { point: "item.custom:note", key: "", props: undefined },
      ],
    );
    for (const { url } of views()) {
      assert.match(url, /^\/api\/views\/[a-f0-9]{32}\.js$/);
      assert.ok(viewBundle(url.slice(11, -3)), "the browser can load it");
    }
    const counterUrl = views()[0]!.url;

    // host.call runs a function of the component's own placement and gives back its result; the
    // extension shows new props at once, reusing the compiled component.
    assert.equal(await runtime.call(chat.id, "session.input.above", "counter", "add", 2), 2);
    assert.deepEqual(views()[0], { point: "session.input.above", key: "counter", url: counterUrl, props: { count: 2 } });
    const code = (expected: string, detail?: RegExp) => (error: { code?: string; detail?: string }) =>
      error.code === expected && (!detail || detail.test(error.detail ?? ""));
    // The extension's own error comes back to the component; the chat is unaffected.
    await assert.rejects(runtime.call(chat.id, "session.input.above", "counter", "jam"), code("extension", /The counter is jammed/));
    // A function that never answers times out; a result that is not JSON is refused.
    await assert.rejects(runtime.call(chat.id, "session.input.above", "counter", "hang"), code("timeout"));
    await assert.rejects(runtime.call(chat.id, "session.input.above", "counter", "notJson"), code("extension", /must be JSON/));
    // A placement reaches only its own functions: the header has no "add", the counter no "removeCounter".
    await assert.rejects(runtime.call(chat.id, "session.header", "", "add", 1), code("not-found"));
    await assert.rejects(runtime.call(chat.id, "session.input.above", "counter", "removeCounter"), code("not-found"));

    // A custom entry with a placed component reaches the browser with its data, even with no terminal renderer.
    await runtime.start(chat.id, "/note saved").completion;
    const page = runtime.items(chat.id, {});
    const note = page.items.find((item) => item.role === "entry");
    assert.deepEqual({ customType: note?.customType, details: note?.details }, { customType: "note", details: { text: "saved" } });

    // The tool call's result carries Pi's details for the tool's point.
    await runtime.start(chat.id, 'tool:shout:{"word":"hi"}').completion;
    const result = runtime.items(chat.id, {}).items.find((item) => item.role === "toolResult" && item.toolName === "shout");
    assert.deepEqual(result?.details, { loud: "HI" });

    // Removing: an event with no component.
    await runtime.call(chat.id, "session.header", "", "removeCounter");
    assert.equal(views().some((v) => v.key === "counter"), false);

    // Refused and broken components are notices, not failures of the chat.
    await runtime.call(chat.id, "session.header", "", "placeOutside");
    await eventually(() => notices().some((n) => /not inside an extension this chat loads/.test(n)));
    await runtime.call(chat.id, "session.header", "", "placeBroken");
    await eventually(() => notices().some((n) => /Broken\.svelte could not be compiled/.test(n)));
    assert.equal(views().some((v) => v.key === "broken"), false);
    // A point is an item of the history or one this host's client draws; anything else is refused.
    await runtime.call(chat.id, "session.header", "", "placeNowhere");
    await eventually(() => notices().some((n) => /unknown point side\.panel/.test(n)));
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
      const response = await call({ point: "session.input.above", key: "counter", name: "add", data: 1 });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { result: i + 1 });
    }
    // The extension's own error, and a function the placement does not have.
    const jam = await call({ point: "session.input.above", key: "counter", name: "jam" });
    assert.equal(jam.status, 200);
    assert.deepEqual(await jam.json(), { error: "extension", detail: "The counter is jammed" });
    assert.equal((await call({ point: "session.header", key: "", name: "add" })).status, 404);
    assert.equal((await call({ point: "session.input.above", key: "counter", name: "add", extra: 1 })).status, 400);

    // A whole view: its component imports a static file of the extension (it gets an address) and reads
    // files from the folder its placement named, and nothing outside it.
    await runtime.call(chat.id, "session.header", "", "placePage");
    await eventually(() => runtime.session(chat.id).extensions.views.some((v) => v.point === "session.view"));
    const pageView = runtime.session(chat.id).extensions.views.find((v) => v.point === "session.view")!;
    const bundle = await (await fetch(`${base}${pageView.url}`)).text();
    const assetUrl = /\/api\/views\/assets\/[a-f0-9]{32}\.svg/.exec(bundle)![0];
    const asset = await fetch(`${base}${assetUrl}`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "image/svg+xml");
    assert.match(asset.headers.get("content-security-policy")!, /sandbox/);
    assert.match(await asset.text(), /<svg/);
    assert.equal((await fetch(`${base}/api/views/assets/${"0".repeat(32)}.svg`)).status, 404);
    const file = (query: Record<string, string>) =>
      fetch(`${base}/api/sessions/${chat.id}/files?${new URLSearchParams(query)}`);
    const items = await file({ point: "session.view", key: "page", path: "items.json" });
    assert.equal(items.status, 200);
    assert.equal(items.headers.get("cache-control"), "no-store");
    assert.match(items.headers.get("content-security-policy")!, /sandbox/);
    assert.deepEqual(await items.json(), { items: ["First listing", "Second listing"] });
    // Outside the folder, the folder itself, a placement that named no folder, an unknown query.
    assert.equal((await file({ point: "session.view", key: "page", path: "../index.mjs" })).status, 404);
    assert.equal((await file({ point: "session.view", key: "page", path: "." })).status, 404);
    assert.equal((await file({ point: "session.input.above", key: "counter", path: "items.json" })).status, 404);
    assert.equal((await file({ point: "session.view", key: "page", path: "items.json", extra: "1" })).status, 400);
    await runtime.call(chat.id, "session.header", "", "removePage");
    assert.equal(runtime.session(chat.id).extensions.views.some((v) => v.point === "session.view"), false);
    assert.equal((await file({ point: "session.view", key: "page", path: "items.json" })).status, 404);

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

test("a host that names no points offers only the items of the history", async () => {
  const h = await testHome("pispark-views-places-");
  try {
    await h.persona("default", { name: "Default" });
    await addViewExtension(h.home, "default");
    const runtime = new SessionRuntime({ ...h.configuration, points: undefined });
    const chat = await runtime.create({ folder: await h.folder("work") });
    await eventually(() => runtime.session(chat.id).extensions.views.length === 2);
    assert.deepEqual(runtime.session(chat.id).extensions.views.map((v) => v.point).sort(), ["item.custom:note", "item.tool:shout"]);
    assert.ok(noticeText(runtime, chat.id).some((n) => /unknown point session\.input\.above/.test(n)));
    await runtime.shutdown();
  } finally {
    await h.remove();
  }
});

test("session.view takes offers: a key and a title each, six at most, requests to be shown counted; commands are listed", async () => {
  const h = await testHome("pispark-views-offers-");
  try {
    await h.persona("default", { name: "Default" });
    await addViewExtension(h.home, "default");
    const runtime = new SessionRuntime(h.configuration);
    const chat = await runtime.create({ folder: await h.folder("work") });
    await eventually(() => runtime.session(chat.id).extensions.views.length === 7);
    const offers = () =>
      runtime
        .session(chat.id)
        .extensions.views.filter((v) => v.point === "session.view")
        .map(({ key, title, attention }) => ({ key, title, attention }));
    const refused = (reason: string) => noticeText(runtime, chat.id).filter((n) => n.includes(reason)).length;
    // The fixture emits whatever it is given, with a component unless told otherwise.
    const emit = (view: object) => runtime.call(chat.id, "session.header", "", "offer", view as never);
    const offer = (view: object) => emit({ point: "session.view", ...view });

    // The names from before the points are refused like any unknown point: there are no aliases.
    for (const old of ["chat.page", "reply.above", "reply.footer", "tool:shout", "custom:note"]) {
      await emit({ point: old });
      await eventually(() => refused(`unknown point ${old}`) === 1);
    }

    // A view needs a key and a title of 1 to 40 characters; only a view takes a title or attention.
    await offer({ title: "No key" });
    await eventually(() => refused("session.view needs a key") === 1);
    for (const title of [undefined, "   ", "x".repeat(41), "two\nlines", 7]) await offer({ key: "a", title });
    await eventually(() => refused("a view needs a title of 1 to 40 characters") === 5);
    await offer({ key: "a", title: "A", attention: "yes" });
    await eventually(() => refused("attention must be true or false") === 1);
    await emit({ point: "session.input.below", title: "A" });
    await emit({ point: "session.input.below", attention: true });
    await eventually(() => refused("session.input.below takes no title or attention") === 2);
    assert.deepEqual(offers(), []);

    // Offers stay in the order first made; the same key updates its offer in place.
    await offer({ key: "a", title: "  First  " });
    await offer({ key: "b", title: "Second" });
    await offer({ key: "a", title: "First again" });
    await eventually(() => offers().length === 2);
    assert.deepEqual(offers(), [
      { key: "a", title: "First again", attention: undefined },
      { key: "b", title: "Second", attention: undefined },
    ]);

    // Each request to be shown counts once; an update that does not ask leaves the count.
    await offer({ key: "b", title: "Second", attention: true });
    await offer({ key: "b", title: "Second", attention: true });
    await offer({ key: "b", title: "Second", attention: false });
    assert.equal(offers()[1]!.attention, 2);

    // Six at most. Updating one of them is not a seventh, and removing one makes room.
    for (const key of ["c", "d", "e", "f"]) await offer({ key, title: key });
    await eventually(() => offers().length === 6);
    await offer({ key: "g", title: "Seventh" });
    await eventually(() => refused("at most 6 views at session.view") === 1);
    await offer({ key: "f", title: "Sixth" });
    await offer({ key: "b", component: null });
    await offer({ key: "g", title: "Seventh" });
    await eventually(() => offers().length === 6 && offers().at(-1)!.key === "g");
    assert.deepEqual(offers().map((v) => v.title), ["First again", "c", "d", "e", "Sixth", "Seventh"]);
    assert.equal(refused("at most 6 views"), 1);
    // A view offered again after it was removed starts counting anew.
    await offer({ key: "c", component: null });
    await offer({ key: "b", title: "Second", attention: true });
    await eventually(() => offers().at(-1)!.key === "b");
    assert.equal(offers().at(-1)!.attention, 1);

    // The commands extensions registered with Pi, as Pi names them; descriptions on one line.
    assert.deepEqual(runtime.session(chat.id).commands, [
      { name: "page", description: "Offer the fixture page; 'show' asks to show it" },
      { name: "note" },
    ]);
    assert.equal(runtime.session(chat.id).error, undefined);

    await runtime.shutdown();
  } finally {
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
    for (let i = 0; i < 10; i++) await first.call(chat.id, "session.input.above", "counter", "add", 1);
    await eventually(() => counter(first, chat.id) === 10, 5000);
    await first.shutdown();

    const second = runtime();
    await second.open(chat.id);
    await eventually(() => counter(second, chat.id) === 10, 5000);
    assert.equal(await second.call(chat.id, "session.input.above", "counter", "add", 1), 11);
    // The saved state is not a chat item: nothing draws "counter" entries.
    assert.equal(second.items(chat.id, {}).items.some((item) => item.customType === "counter"), false);
  } finally {
    await Promise.allSettled(runtimes.map((r) => r.shutdown()));
    await h.remove();
  }
});
