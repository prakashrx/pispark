import assert from "node:assert/strict";
import test from "node:test";
import { styledLines, tidy, webTheme } from "../src/extensions/styled-text.js";
import { SessionRuntime } from "../src/runtime/session-runtime.js";
import { testHome } from "./fixtures/home.js";

test("styled text: Pi theme colors become PiSpark roles; raw colors, links and layout survive", () => {
  const t = webTheme;
  assert.deepEqual(styledLines(`${t.fg("accent", "a")} ${t.bold(t.fg("error", "b"))}`), [
    [{ text: "a", fg: "accent" }, { text: " " }, { text: "b", fg: "danger", bold: true }],
  ]);
  assert.deepEqual(styledLines(t.bg("selectedBg", t.fg("dim", "x"))), [
    [{ text: "x", fg: "subtle", bg: "selected" }],
  ]);
  assert.deepEqual(styledLines("\x1b[31mred\x1b[0m \x1b[38;2;16;32;48mrgb\x1b[39m\x1b[38;5;196m!"), [
    [{ text: "red", fg: "danger" }, { text: " " }, { text: "rgb", fg: "#102030" }, { text: "!", fg: "#ff0000" }],
  ]);
  assert.deepEqual(styledLines("\x1b]8;;https://pi.dev\x07site\x1b]8;;\x07\x1b[2K x\ty\x1b_pi:c\x07"), [
    [{ text: "site", link: "https://pi.dev" }, { text: " x	y" }],
  ]);
  assert.deepEqual(styledLines("\x1b]8;;javascript:alert(1)\x07no\x1b]8;;\x07"), [[{ text: "no" }]]);
  assert.deepEqual(tidy(styledLines(["", "  one   ", "    two", ""])), [[{ text: "one" }], [{ text: "  two" }]]);
  assert.equal(styledLines("x".repeat(1000))[0]![0]!.text.length, 400);
  assert.equal(styledLines("\n".repeat(1000)).length, 200);
});

const RENDERING = `
import { Text } from "@earendil-works/pi-tui";
export default function (pi) {
  pi.registerTool({
    name: "shout",
    label: "Shout",
    description: "Shout a word",
    parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"] },
    async execute(_id, params) {
      return { content: [{ type: "text", text: params.word.toUpperCase() }], details: {} };
    },
    renderCall: (args, theme) => new Text(theme.bold("shout ") + theme.fg("accent", args.word), 0, 0),
    renderResult: (result, _options, theme) => new Text(theme.fg("success", result.content[0].text), 0, 0),
  });
  pi.registerMessageRenderer("card", (message, _options, theme) =>
    new Text(theme.fg("accent", "[card]") + " " + message.content, 0, 0));
  pi.registerEntryRenderer("note", (entry, _options, theme) =>
    new Text(theme.fg("muted", "note: " + entry.data.text), 1, 1));
  pi.registerCommand("note", { handler: async (args) => pi.appendEntry("note", { text: args.trim() }) });
  pi.registerCommand("card", {
    handler: async (args) => {
      pi.sendMessage({ customType: "card", content: args.trim(), display: true });
      pi.sendMessage({ customType: "secret", content: "not for display", display: false });
    },
  });
}
`;

test("extension renderers draw tool calls and results, custom messages and entries without a terminal", async () => {
  const h = await testHome("pispark-render-");
  try {
    await h.persona("default", { name: "Default" }, { "extensions/render.mjs": RENDERING });
    h.provider.automatic = true;
    const runtime = new SessionRuntime(h.configuration);
    const chat = await runtime.create({ folder: await h.folder("work") });
    await runtime.start(chat.id, 'tool:shout:{"word":"hi"}').completion;
    await runtime.start(chat.id, "/note saved").completion;
    await runtime.start(chat.id, "/card shown").completion;
    const window = runtime.window(chat.id);
    const tool = window.messages.find((m) => m.role === "toolResult");
    assert.deepEqual(tool?.rendered, {
      call: [[{ text: "shout ", bold: true }, { text: "hi", fg: "accent" }]],
      body: [[{ text: "HI", fg: "success" }]],
    });
    assert.deepEqual(window.messages.map((m) => m.role), ["user", "assistant", "toolResult", "assistant", "custom"]);
    const custom = window.messages.filter((m) => m.role === "custom");
    assert.equal(custom.length, 1, "messages marked display: false stay hidden");
    assert.deepEqual(custom[0]!.rendered?.body, [[{ text: "[card]", fg: "accent" }, { text: " shown" }]]);
    // The entry sits where it was appended: after Pi's system message and the tool turn.
    assert.deepEqual(window.entries.map((e) => [e.after, e.lines]), [[5, [[{ text: "note: saved", fg: "muted" }]]]]);
    await runtime.shutdown();
  } finally {
    await h.remove();
  }
});
