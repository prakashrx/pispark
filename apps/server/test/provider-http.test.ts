import assert from "node:assert/strict";
import { test } from "node:test";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { SessionHttp } from "../src/http/session-http.js";
import { ProviderHttp } from "../src/http/provider-http.js";
import { createAppServer } from "../src/http/server.js";
import { localProviderSettings } from "./fixtures/provider-settings.js";

async function host(t: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(join(tmpdir(), "pispark-provider-http-"));
  const f = await localProviderSettings(root);
  const configuration = { home: join(root, "pispark") };
  const handlers = new SessionHttp(
    new SessionRuntime(configuration, f.settings),
    undefined,
    new ProviderHttp(f.settings),
  );
  const server = createAppServer({ sessions: handlers });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await handlers.shutdown();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  });
  const post = (
    path: string,
    value: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(origin + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...headers,
      },
      body: JSON.stringify(value),
    });
  return { ...f, origin, post };
}

test("ProviderHttp: Host/Origin/Fetch Metadata negative cases cover auth observation and mutations", async (t) => {
  const h = await host(t);
  for (const path of [
    "/api/providers/default",
    "/api/providers/auth/start",
    "/api/providers/auth/observe",
    "/api/providers/logout",
  ]) {
    assert.equal(
      (await h.post(path, {}, { Origin: "https://evil.invalid" })).status,
      403,
    );
    assert.equal(
      (await h.post(path, {}, { "Sec-Fetch-Site": "cross-site" })).status,
      403,
    );
    assert.equal(
      (await h.post(path, {}, { Origin: "", "Sec-Fetch-Site": "same-origin" }))
        .status,
      403,
    );
  }
  const status = await new Promise<number>((resolve) => {
    const req = httpRequest(
      h.origin + "/api/providers",
      { headers: { Host: "evil.invalid" } },
      (response) => {
        response.resume();
        resolve(response.statusCode!);
      },
    );
    req.end();
  });
  assert.equal(status, 403);
  assert.equal(
    (await fetch(h.origin + "/api/providers", { headers: { Origin: "null" } }))
      .status,
    403,
  );
});

test("ProviderHttp: two clients cannot observe/respond/cancel each other's transaction; no session receipt or secret replay", async (t) => {
  const h = await host(t);
  const response = await h.post("/api/providers/auth/start", {
    provider: "pispark-local-test",
    method: "api_key",
  });
  assert.equal(response.status, 201);
  const c = await response.json();
  const path = "/api/providers/auth/observe";
  assert.equal((await h.post(path, { id: c.id })).status, 400);
  assert.equal(
    (
      await h.post(
        path,
        { id: c.id },
        { Authorization: `Bearer ${"a".repeat(43)}` },
      )
    ).status,
    400,
  );
  const headers = { Authorization: `Bearer ${c.token}` };
  let view;
  for (let i = 0; i < 50; i++) {
    view = await (await h.post(path, { id: c.id }, headers)).json();
    if (view.prompt) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(view.prompt.type, "secret");
  assert.equal(
    (await h.post("/api/providers/auth/cancel", { id: c.id })).status,
    400,
  );
  assert.equal(
    (
      await h.post("/api/providers/auth/respond", {
        id: c.id,
        prompt: view.prompt.id,
        value: "TEST-ONLY-NOT-REAL",
      })
    ).status,
    400,
  );
  const input = {
    id: c.id,
    prompt: view.prompt.id,
    value: "TEST-ONLY-NOT-REAL",
  };
  assert.equal(
    (await h.post("/api/providers/auth/respond", input, headers)).status,
    200,
  );
  assert.equal(
    (await h.post("/api/providers/auth/respond", input, headers)).status,
    400,
  );
  for (let i = 0; i < 50; i++) {
    view = await (await h.post(path, { id: c.id }, headers)).json();
    if (view.state !== "pending") break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(view.state, "saved");
  assert.doesNotMatch(
    JSON.stringify(view),
    /TEST-ONLY|"token"|"key"|"credential"/,
  );
  assert.equal((await fetch(h.origin + `/api/receipts/${c.id}`)).status, 404);
  assert.deepEqual(
    (await (await fetch(h.origin + "/api/sessions")).json()).sessions,
    [],
  );
});

test("ProviderHttp: strict payloads, no query capabilities, unsupported methods, bounded response/request", async (t) => {
  const h = await host(t);
  const catalog = await fetch(h.origin + "/api/providers");
  assert.equal(catalog.status, 200);
  assert((await catalog.text()).length < 2 * 1024 * 1024);
  for (const value of [
    { provider: "missing", method: "api_key" },
    { provider: "pispark-local-test", method: "unknown" },
    {
      provider: "pispark-local-test",
      method: "api_key",
      token: "client-chosen",
    },
  ])
    assert.equal(
      (await h.post("/api/providers/auth/start", value)).status,
      400,
    );
  assert.equal(
    (await h.post("/api/providers/auth/observe?token=unsafe", { id: "x" }))
      .status,
    400,
  );
  assert.equal(
    (
      await h.post("/api/providers/default", {
        model: { provider: "x", id: "x", key: "forbidden" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await h.post("/api/providers/auth/respond", { value: "x".repeat(17000) }))
      .status,
    400,
  );
  assert.equal(
    (
      await h.post(
        "/api/providers/auth/start",
        {},
        { "Content-Type": "text/plain" },
      )
    ).status,
    400,
  );
  assert.equal(
    (await fetch(h.origin + "/api/providers/auth/observe")).status,
    404,
  );
});

for (const type of ["text", "secret", "manual_code"] as const)
  test(`ProviderHttp: preserves blank native ${type} response; identity remains nonempty`, async (t) => {
    const h = await host(t);
    let received: string | undefined;
    h.control.customLogin = async (i) => {
      received = await i.prompt({ type, message: "Optional native response" });
    };
    const c = await (
      await h.post("/api/providers/auth/start", {
        provider: "pispark-local-test",
        method: "api_key",
      })
    ).json();
    const headers = { Authorization: `Bearer ${c.token}` };
    let view;
    for (let i = 0; i < 100; i++) {
      view = await (
        await h.post("/api/providers/auth/observe", { id: c.id }, headers)
      ).json();
      if (view.prompt) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(
      (
        await h.post(
          "/api/providers/auth/respond",
          { id: "", prompt: view.prompt.id, value: "" },
          headers,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await h.post(
          "/api/providers/auth/respond",
          { id: c.id, prompt: "", value: "" },
          headers,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await h.post(
          "/api/providers/auth/respond",
          { id: c.id, prompt: view.prompt.id, value: "" },
          headers,
        )
      ).status,
      200,
    );
    for (let i = 0; received === undefined && i < 100; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(received, "");
  });

for (const failure of ["throws", "hangs"] as const)
  test(`SessionHttp: session cleanup begins independently when provider cleanup ${failure}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "pispark-shutdown-"));
    const f = await localProviderSettings(root);
    f.control.automatic = true;
    const config = {
      home: join(root, "pispark"),
      fixedModel: { provider: f.control.provider, id: "deterministic" },
    };
    const runtime = new SessionRuntime(config);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const providers = new ProviderHttp(f.settings);
    providers.shutdown =
      failure === "throws"
        ? async () => {
            throw Error("PRIVATE_CLEANUP_ERROR");
          }
        : async () => {
            await gate;
          };
    const handlers = new SessionHttp(runtime, undefined, providers);
    t.after(async () => {
      release();
      await runtime.shutdown();
      await providers.auth.shutdown();
      await f.settings.close();
      await rm(root, { recursive: true, force: true });
    });
    const session = await runtime.create({ folder: root });
    f.control.automatic = false;
    const run = runtime.start(session.id, "hold active session");
    const closing = handlers.shutdown();
    const observed = closing.catch(() => {});
    const result = await run.completion;
    assert.equal(result.outcome, "cancelled");
    if (failure === "throws")
      await assert.rejects(closing, /PRIVATE_CLEANUP_ERROR/);
    else {
      let done = false;
      void closing.then(() => {
        done = true;
      });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(done, false);
      release();
      await closing;
    }
    await observed;
    assert.equal(
      runtime.list().find((s) => s.id === session.id)?.status,
      "unloaded",
    );
  });
