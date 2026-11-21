import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWebResearch } from "../src/core/extensions/web-research.js";

function session(key = "test-search-key") {
  const tools = new Map<string, {
    execute(id: string, input: object, signal?: AbortSignal): Promise<{ content: [{ text: string }] }>;
  }>();
  let start: (() => void) | undefined;
  const pi = {
    on(event: string, handler: () => void) {
      assert.equal(event, "agent_start");
      start = handler;
    },
    registerTool(tool: NonNullable<ReturnType<typeof tools.get>> & { name: string }) {
      tools.set(tool.name, tool);
    },
  } as unknown as ExtensionAPI;
  registerWebResearch(pi, key);
  return {
    tools,
    start: () => start?.(),
    async run(name: "search" | "read", input: object, signal?: AbortSignal) {
      const tool = tools.get("pispark_web_" + name);
      assert.ok(tool);
      const answer = await tool.execute("test-call", input, signal);
      return answer.content[0].text;
    },
  };
}

test("web research is only registered when configured", () => {
  assert.equal(session("").tools.size, 0);
  assert.equal(session().tools.size, 2);
});

test("search returns compact, distinct public sources from the search endpoint", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "https://api.tavily.com/search");
    assert.equal(new Headers(options.headers).get("Authorization"), "Bearer test-search-key");
    assert.equal(options.redirect, "error");
    const args = JSON.parse(String(options.body));
    assert.equal(args.query, "widgets");
    assert.equal(args.max_results, 5);
    assert.equal(args.include_raw_content, false);
    return Response.json({ results: [
      { url: "https://user:secret@example.com/", title: "Credentials" },
      { url: "http://127.0.0.1/", title: "Local" },
      ...Array.from({ length: 8 }, (_, n) => ({
        url: "https://example.com/source/" + n,
        title: "Title " + n,
        content: "relevant text ".repeat(100) + "unreachable tail",
        raw_content: "DO NOT INCLUDE",
      })),
    ] });
  });
  const web = session();
  const search = await web.run("search", { query: "widgets" });
  assert.equal(search.match(/https:\/\//g)?.length, 5);
  assert.match(search, /Title 0\nhttps:\/\/example.com\/source\/0\nrelevant text/);
  assert.doesNotMatch(search, /secret|Local|unreachable tail|DO NOT INCLUDE|Title 5/);
  assert.match(await web.run("search", { query: "  WIDGETS " }), /Already requested/);
  assert.equal(request.mock.callCount(), 1);
});

test("page reading requests actual relevant passages and shares a UTF-8 budget with search", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    const args = JSON.parse(String(options.body));
    if (url === "https://api.tavily.com/search") {
      return Response.json({ results: [{ url: "https://example.com", title: "Index", content: "x".repeat(360) }] });
    }
    assert.equal(url, "https://api.tavily.com/extract");
    assert.deepEqual(args.urls, ["https://example.com/guide"]);
    assert.equal(args.chunks_per_source, 3);
    assert.ok(args.query.startsWith("Installation"));
    assert.equal(args.format, "text");
    return Response.json({
      results: [{ url: args.urls[0], raw_content: "Requirements\n\n" + "😀".repeat(4_000) }],
      failed_results: [],
    });
  });
  const web = session();
  const index = await web.run("search", { query: "widgets" });
  const answers = await Promise.all(Array.from({ length: 4 }, (_, n) =>
    web.run("read", { url: "https://example.com/guide", focus: "Installation " + n }),
  ));
  assert.ok(answers.every((answer) => answer.startsWith("Source: https://example.com/guide\n")));
  assert.match(answers[0]!, /Requirements\n\n😀/);
  assert.doesNotMatch(answers.join(""), /\uFFFD/);
  const bytes = Buffer.byteLength(index) + answers.reduce((sum, answer) => sum + Buffer.byteLength(answer), 0);
  assert.ok(bytes <= 8_192 && bytes > 8_000, String(bytes));
  assert.match(await web.run("search", { query: "unnecessary" }), /budget/);
  assert.equal(request.mock.callCount(), 5);
  web.start();
  assert.match(await web.run("search", { query: "widgets" }), /Index/);
  assert.equal(request.mock.callCount(), 6);
});

test("unavailable sources, bounded responses, credentials, and cancellation are explicit", async (t) => {
  let response = new Response("credential-proof-should-not-leak", { status: 401 });
  const request = t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    options.signal?.throwIfAborted();
    return response;
  });
  const web = session();
  for (const url of ["file:///C:/Windows/hosts", "http://127.1", "https://example.ts.net", "https://localhost."]) {
    await assert.rejects(web.run("read", { url, focus: "contents" }), /public web URL/);
  }
  assert.equal(request.mock.callCount(), 0);
  await assert.rejects(web.run("search", { query: "first" }), {
    message: "Web research credentials were rejected. Check the PiSpark server’s Tavily key.",
  });
  response = Response.json({ results: [], failed_results: [{ url: "https://example.com/guide" }] });
  assert.match(await web.run("read", { url: "https://example.com/guide", focus: "contents" }), /No page passages/);
  response = new Response("x".repeat(262_145));
  await assert.rejects(web.run("search", { query: "second" }), /response exceeded its size limit/);
  const ctrl = new AbortController();
  ctrl.abort(new Error("Stopped by the session"));
  await assert.rejects(web.run("search", { query: "third" }, ctrl.signal), /Stopped by the session/);
});

test("empty results cannot bypass the outbound request limit", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => Response.json({ results: [] }));
  const web = session();
  for (let i = 0; i < 6; i++)
    assert.match(await web.run("search", { query: "look up " + i }), /No usable public sources/);
  assert.match(await web.run("search", { query: "one more" }), /budget/);
  assert.equal(request.mock.callCount(), 6);
});
