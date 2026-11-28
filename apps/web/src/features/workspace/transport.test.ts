import { afterEach, describe, expect, it, vi } from "vitest";
import { agentRequest } from "../agent/agent-client.svelte";
import { providerRequest } from "../settings/provider-client.svelte";
import { RequestFailed, ResponseTooLarge, requestJson } from "./transport";

/** Every fetch answers with this status and JSON body. */
function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("requestJson", () => {
  it("returns the answer, and throws an error answer's status, code and detail", async () => {
    answer(200, { ok: 1 });
    expect(await requestJson("/api/x")).toEqual({ ok: 1 });
    answer(409, { error: "in-use", detail: "shop" });
    const failed = await requestJson("/api/x").catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(RequestFailed);
    expect(failed).toMatchObject({ status: 409, code: "in-use", detail: "shop", message: "in-use" });
    answer(500, {});
    expect(await requestJson("/api/x").catch((error: unknown) => error)).toMatchObject({
      status: 500,
      code: undefined,
      message: "Request failed",
    });
  });

  it("refuses an answer past its limit", async () => {
    answer(200, "x".repeat(2048));
    await expect(requestJson("/api/x", {}, { limit: 1024 })).rejects.toBeInstanceOf(ResponseTooLarge);
  });

  it("stops when the caller's signal aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_path: string, init: RequestInit) =>
          new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
      ),
    );
    const caller = new AbortController();
    const request = requestJson("/api/x", { signal: caller.signal });
    caller.abort(new Error("stopped"));
    await expect(request).rejects.toThrow("stopped");
  });

  it("reloads at the pairing screen when the device was removed", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    answer(401, { error: "unpaired" });
    await expect(requestJson("/api/x")).rejects.toBeInstanceOf(RequestFailed);
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("agent and provider requests say what went wrong as before", () => {
  it("agents", async () => {
    answer(409, { error: "in-use", detail: "shop" });
    await expect(agentRequest("delete", {})).rejects.toThrow(/^Another agent builds on this one: shop\.$/);
    answer(500, {});
    await expect(agentRequest("")).rejects.toThrow(/^Couldn’t read or save on the server\.$/);
    answer(400, { error: "something-new" });
    await expect(agentRequest("")).rejects.toThrow(/^Something went wrong\.$/);
    answer(200, "x".repeat(512 * 1024 + 1));
    await expect(agentRequest("")).rejects.toThrow(/^Response limit$/);
  });

  it("providers", async () => {
    answer(503, { error: "network-blocked" });
    await expect(providerRequest("")).rejects.toThrow(/^Provider operations are disabled on this host: install an owner-approved/);
    answer(400, { error: "something-new" });
    await expect(providerRequest("")).rejects.toThrow(
      /^Provider settings request failed\. Reload status before trying again; no successful change is confirmed\.$/,
    );
    answer(200, "x".repeat(2 * 1024 * 1024 + 1));
    await expect(providerRequest("")).rejects.toThrow(/^Provider catalog exceeds the display limit\.$/);
  });
});
