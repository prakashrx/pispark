import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { resolveSetup, viewPersona } from "../src/core/personas/resolve.js";
import { ToolDiscovery } from "../src/core/runtime/tool-discovery.js";
import { standardDefault, testHome } from "./fixtures/home.js";

const GREET = `export default (pi) => pi.registerTool({
  name: "greet", label: "Greet", description: "Says hello.",
  parameters: { type: "object", properties: {} },
  execute: async () => ({ content: [{ type: "text", text: "hello" }], details: undefined }),
});`;

test("a persona's tools are found by loading its extensions, grouped PiSpark first", async () => {
  const h = await testHome("pispark-tools-");
  await standardDefault(h.home);
  await h.persona("helper", { name: "Helper", off: ["tool:pispark_schedule", "tool:gone"] }, { "extensions/greet.mjs": GREET });
  const runtime = new SessionRuntime({ ...h.configuration, wakeTickMs: 0 });
  try {
    const target = { persona: "helper" };
    const discovered = await runtime.discoverTools(target);
    assert.equal(discovered?.incomplete, false);
    const view = viewPersona(runtime.personas, target, discovered);
    const row = (name: string) => view.tools.find((tool) => tool.name === name)!;

    // PiSpark: Pi's built-in tools, then PiSpark's own, found in its built-in extension.
    const core = view.tools.filter((tool) => tool.source?.kind === "core").map((tool) => tool.name);
    assert.deepEqual(core.slice(0, 2), ["read", "bash"]);
    assert.ok(core.includes("pispark_set_title") && core.includes("pispark_schedule"));
    assert.equal(row("pispark_set_title").label, "Set chat title");
    assert.equal(row("pispark_set_title").on, true);
    assert.equal(row("pispark_schedule").on, false);
    // The persona's extension, as its own group; a switch naming nothing provided comes last.
    assert.deepEqual(row("greet").source, { kind: "extension", name: "greet" });
    assert.deepEqual([row("greet").label, row("greet").on], ["Greet", true]);
    assert.equal(row("gone").source, undefined);
    assert.equal(view.tools.at(-1)!.name, "gone");

    // A persona that cannot be resolved lists nothing; its view says why.
    assert.equal(await runtime.discoverTools({ persona: "missing" }), undefined);
  } finally {
    await runtime.shutdown();
    await h.remove();
  }
});

test("tools a running session had (such as an MCP server's) are remembered for the editor", async () => {
  const h = await testHome("pispark-tools-seen-");
  await standardDefault(h.home);
  await h.persona("helper", { name: "Helper" }, { "extensions/greet.mjs": GREET });
  const runtime = new SessionRuntime({ ...h.configuration, wakeTickMs: 0 });
  const discovery = new ToolDiscovery(h.home);
  try {
    const setup = resolveSetup(runtime.personas, { persona: "helper" });
    assert.ok(!(await discovery.tools(setup)).tools.some((tool) => tool.name === "mcp__github__search"));
    discovery.remember(setup.fingerprint, setup.extensionPaths, [
      { name: "read", sourceInfo: { path: "builtin:read" } },
      { name: "greet", sourceInfo: { path: setup.extensionPaths.at(-1)! } },
      { name: "mcp__github__search", description: "Search GitHub." },
    ]);
    const tools = (await discovery.tools(setup)).tools;
    assert.deepEqual(tools.find((tool) => tool.name === "mcp__github__search")?.source, { kind: "mcp", name: "github" });
    // Known ones are not listed twice; Pi's own are not remembered.
    assert.equal(tools.filter((tool) => tool.name === "greet").length, 1);
    assert.ok(!tools.some((tool) => tool.name === "read"));
  } finally {
    await runtime.shutdown();
    await h.remove();
  }
});
