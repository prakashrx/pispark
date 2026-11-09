import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { compileView, viewBundle } from "../src/extensions/view-compiler.js";
import { SessionRuntime } from "../src/runtime/session-runtime.js";
import { addViewExtension, testHome, viewExtension } from "./fixtures/home.js";

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

test("extensions place components with Pi's bus: slots, props, events back, entries with data, failures", async () => {
  const h = await testHome("pispark-views-");
  try {
    await h.persona("default", { name: "Default" });
    await addViewExtension(h.home, "default");
    // A component outside the extension's folder is refused.
    await writeFile(join(h.home, "personas", "default", "extensions", "Outside.svelte"), "<p>no</p>");
    h.provider.automatic = true;
    const runtime = new SessionRuntime(h.configuration);
    const chat = await runtime.create({ folder: await h.folder("work") });
    const views = () => runtime.session(chat.id).extensions.views;
    const notices = () => runtime.session(chat.id).extensions.notices.map((n) => n.lines.map((l) => l.map((s) => s.text).join("")).join(" "));

    // Placed while the extension loaded; each shows once compiled.
    await eventually(() => views().length === 4);
    assert.deepEqual(
      views().map(({ slot, key, props }) => ({ slot, key, props })),
      [
        { slot: "above-reply", key: "counter", props: { count: 0 } },
        { slot: "header", key: "", props: { text: "Fixture banner" } },
        { slot: "tool:shout", key: "", props: undefined },
        { slot: "entry:note", key: "", props: undefined },
      ],
    );
    for (const { url } of views()) {
      assert.match(url, /^\/api\/views\/[a-f0-9]{32}\.js$/);
      assert.ok(viewBundle(url.slice(11, -3)), "the browser can load it");
    }
    const counterUrl = views()[0]!.url;

    // A component's event reaches its extension on the chat's bus; new props come back at once,
    // reusing the compiled component.
    runtime.emit(chat.id, "view-fixture:add", { by: 2 });
    assert.deepEqual(views()[0], { slot: "above-reply", key: "counter", url: counterUrl, props: { count: 2 } });
    // PiSpark's own channels are not open to components.
    assert.throws(() => runtime.emit(chat.id, "pispark:view", {}), (error: { code?: string }) => error.code === "invalid-input");

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
    runtime.emit(chat.id, "view-fixture:remove");
    assert.equal(views().some((v) => v.key === "counter"), false);

    // Refused and broken components are notices, not failures of the chat.
    runtime.emit(chat.id, "view-fixture:outside");
    await eventually(() => notices().some((n) => /not inside an extension this chat loads/.test(n)));
    runtime.emit(chat.id, "view-fixture:broken");
    await eventually(() => notices().some((n) => /Broken\.svelte could not be compiled/.test(n)));
    assert.equal(views().some((v) => v.key === "broken"), false);
    assert.equal(runtime.session(chat.id).error, undefined);

    await runtime.shutdown();
  } finally {
    await h.remove();
  }
});
