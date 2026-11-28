/** A real SessionHttp on a loopback port over a test home, with helpers to send and settle commands. */
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { SessionRuntime, type RuntimeConfiguration } from "../../src/core/runtime/session-runtime.js";
import { SessionHttp } from "../../src/http/session-http.js";
import { createAppServer } from "../../src/http/server.js";
import type { Receipt } from "../../src/contract/protocol.js";
import { testHome } from "./home.js";

export async function httpFixture(t: TestContext, extensions: Record<string, string> = {}, options: Partial<RuntimeConfiguration> = {}) {
  const h = await testHome("pispark-http-");
  const root = h.root;
  const folders = { a: await h.folder("a"), b: await h.folder("b") };
  await h.agent("default", { name: "Default" }, { "instructions/test.md": "test only", ...extensions });
  const provider = h.provider;
  const configuration = { ...h.configuration, ...options };
  const runtime = new SessionRuntime(configuration);
  const http = new SessionHttp(runtime);
  const server = createAppServer({ sessions: http });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await http.shutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const post = async (command: Record<string, unknown>) => {
    const response = await fetch(`${base}/api/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ commandId: randomUUID(), ...command }),
    });
    assert.equal(response.status, 202);
    return (await response.json()) as Receipt;
  };
  const settle = async (receipt: Receipt) => {
    while (receipt.state === "accepted") {
      await new Promise((r) => setTimeout(r, 5));
      receipt = (await (await fetch(`${base}/api/receipts/${receipt.commandId}`)).json()) as Receipt;
    }
    return receipt;
  };
  const create = async (folder: "a" | "b") => {
    const r = await settle(await post({ type: "create", folder: folders[folder] }));
    assert.equal(r.outcome, "completed");
    return r.sessionId!;
  };
  return {
    root,
    base,
    runtime,
    http,
    provider,
    post,
    settle,
    create,
    configuration,
    folders,
    home: h.home,
  };
}
