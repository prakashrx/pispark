import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { ProviderAuth, safeAuthUrl } from "../src/runtime/provider-auth.js";
import { ProviderSettings } from "../src/runtime/provider-settings.js";
import {
  nativeModelRuntime,
  requireSupportedTransport,
} from "../src/runtime/native-model-runtime.js";
import { ModelDefaults } from "../src/runtime/provider-storage.js";
import { localProviderSettings } from "./fixtures/provider-settings.js";
import { eventually } from "./fixtures/local-provider.js";
import { SessionRuntime } from "../src/runtime/session-runtime.js";
import { bundledTransportPatched } from "../src/host-configuration.js";

async function fixture(t: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(join(tmpdir(), "pispark-provider-"));
  const f = await localProviderSettings(root);
  const auth = new ProviderAuth(f.settings);
  const owned: (() => Promise<void>)[] = [];
  t.after(async () => {
    for (const cleanup of owned) await cleanup();
    await auth.shutdown();
    await f.settings.close();
    await rm(root, { recursive: true, force: true });
  });
  return { ...f, auth, owned };
}
const id = "pispark-local-test";
async function current(
  auth: ProviderAuth,
  c: { id: string; token: string },
  type: string,
) {
  await eventually(() => auth.observe(c.id, c.token).prompt?.type === type);
  return auth.observe(c.id, c.token).prompt!;
}

test("ProviderAuth: native API-key login persists native secret; owner-only current prompt, no replay and logout", async (t) => {
  const f = await fixture(t);
  const c = f.auth.start(id, "api_key");
  const prompt = await current(f.auth, c, "secret");
  assert.throws(() => f.auth.observe(c.id, "x".repeat(43)), /auth-invalid/);
  assert.throws(
    () => f.auth.respond(c.id, c.token, "stale", "test-key"),
    /auth-invalid/,
  );
  assert.throws(
    () => f.auth.respond(c.id, "x".repeat(43), prompt.id, "test-key"),
    /auth-invalid/,
  );
  assert.throws(
    () => f.auth.respond(c.id, c.token, prompt.id, "a".repeat(8193)),
    /auth-invalid/,
  );
  await assert.rejects(f.settings.logout(id), /provider-busy/);
  await assert.rejects(f.settings.refresh(id), /provider-busy/);
  f.auth.respond(c.id, c.token, prompt.id, "test-native-key");
  assert.throws(
    () => f.auth.respond(c.id, c.token, prompt.id, "duplicate"),
    /auth-invalid/,
  );
  await eventually(() => f.auth.observe(c.id, c.token).state === "saved");
  assert.equal((await readStoredCredential(id, f.authPath))?.type, "api_key");
  assert.match(await readFile(f.authPath, "utf8"), /test-native-key/);
  assert.doesNotMatch(
    JSON.stringify(f.auth.observe(c.id, c.token)),
    /test-native-key|test-key|SECRET/,
  );
  const catalog = await f.settings.catalog();
  assert.equal(catalog.providers.find((p) => p.id === id)?.stored, true);
  assert.doesNotMatch(
    JSON.stringify(catalog),
    /PRIVATE_SOURCE|baseUrl|headers|test-native-key/,
  );
  await f.settings.logout(id);
  assert.equal(await readStoredCredential(id, f.authPath), undefined);
});

test("ProviderAuth: actual native OAuth text/select/manual prompts and info/URL/device/progress, callback wins manual race", async (t) => {
  const f = await fixture(t);
  const c = f.auth.start(id, "oauth");
  let prompt = await current(f.auth, c, "text");
  assert.deepEqual(
    f.auth.observe(c.id, c.token).events.map((e) => e.type),
    ["info", "auth_url", "device_code", "progress"],
  );
  f.auth.respond(c.id, c.token, prompt.id, "local-project");
  prompt = await current(f.auth, c, "select");
  assert.throws(
    () => f.auth.respond(c.id, c.token, prompt.id, "Local"),
    /auth-invalid/,
  );
  f.auth.respond(c.id, c.token, prompt.id, "local");
  prompt = await current(f.auth, c, "manual_code");
  f.control.callbackWon = true;
  f.control.callback.abort();
  assert.throws(
    () => f.auth.respond(c.id, c.token, prompt.id, "late-code"),
    /auth-invalid/,
  );
  await eventually(() => f.auth.observe(c.id, c.token).state === "saved");
  assert.deepEqual(f.control.prompts, ["text", "select", "manual_code"]);
  assert.equal((await readStoredCredential(id, f.authPath))?.type, "oauth");
  assert.deepEqual(f.auth.observe(c.id, c.token).events, []);
});

test("ProviderAuth: per-prompt pre-abort, whole-flow cancellation and error causes never persist credentials", async (t) => {
  const f = await fixture(t);
  f.control.customLogin = async (interaction) => {
    await interaction.prompt({
      type: "manual_code",
      message: "already gone",
      signal: AbortSignal.abort(),
    });
  };
  let c = f.auth.start(id, "api_key");
  await eventually(() => f.auth.observe(c.id, c.token).state === "failed");
  assert.equal(await readStoredCredential(id, f.authPath), undefined);
  f.control.customLogin = undefined;
  c = f.auth.start(id, "api_key");
  await current(f.auth, c, "secret");
  f.auth.cancel(c.id, c.token);
  await eventually(() => f.auth.observe(c.id, c.token).state === "cancelled");
  assert.equal(f.auth.observe(c.id, c.token).prompt, undefined);
  f.control.customLogin = async () => {
    throw Error("PRIVATE_ERROR_secret");
  };
  c = f.auth.start(id, "api_key");
  await eventually(() => f.auth.observe(c.id, c.token).state === "failed");
  assert.doesNotMatch(
    JSON.stringify(f.auth.observe(c.id, c.token)),
    /PRIVATE_ERROR|secret/,
  );
});

test("ProviderAuth: finite no-client lease, whole deadline, capacity and terminal retention free slots", async (t) => {
  const f = await fixture(t);
  // Drive public operations' native sweep using a clock, not a 25ms scheduling window.
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const auth = new ProviderAuth(f.settings, {
    lease: 30,
    deadline: 80,
    retention: 25,
    capacity: 1,
  });
  f.owned.push(() => auth.shutdown());
  let c = auth.start(id, "api_key");
  await current(auth, c, "secret");
  assert.throws(() => auth.start(id, "api_key"), /auth-limit/);
  now += 31;
  await eventually(() => auth.observe(c.id, c.token).state === "cancelled");
  now += 26;
  assert.throws(() => auth.observe(c.id, c.token), /auth-invalid/);
  c = auth.start(id, "api_key");
  await current(auth, c, "secret");
  for (let i = 0; i < 3; i++) {
    now += 20;
    assert.equal(auth.observe(c.id, c.token).state, "pending");
  }
  now += 21; // Whole deadline expires while the renewed lease is still valid.
  await eventually(() => auth.observe(c.id, c.token).state === "cancelled");
});

test("ProviderAuth: native synchronization partial failures accurately distinguish committed login/logout", async (t) => {
  const f = await fixture(t);
  const c = f.auth.start(id, "api_key");
  const p = await current(f.auth, c, "secret");
  f.control.syncFails = true;
  f.auth.respond(c.id, c.token, p.id, "test-saved-key");
  await eventually(
    () => f.auth.observe(c.id, c.token).state === "saved-sync-failed",
  );
  assert.equal(
    (await f.runtime.listCredentials()).some((c) => c.providerId === id),
    true,
  );
  await assert.rejects(f.settings.catalog(), /provider-configuration/);
  await assert.rejects(f.settings.logout(id), /removed-sync-failed/);
  assert.equal(await readStoredCredential(id, f.authPath), undefined);
  assert.doesNotMatch(
    JSON.stringify(f.auth.observe(c.id, c.token)),
    /test-saved-key|PRIVATE_SYNC_ERROR/,
  );
});

test("nativeModelRuntime: file-backed login survives runtime restart; concurrent OAuth refresh uses native lock", async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.authPath,
    JSON.stringify({
      [id]: {
        type: "oauth",
        access: "expired",
        refresh: "test-refresh",
        expires: 0,
      },
    }),
  );
  const peer = await nativeModelRuntime({
    authPath: f.authPath,
    modelsPath: null,
  });
  peer.registerNativeProvider(f.control.native());
  const values = await Promise.all([f.runtime.getAuth(id), peer.getAuth(id)]);
  assert.equal(f.control.refreshes, 1);
  assert.deepEqual(
    values.map((v) => v?.auth.apiKey),
    ["test-refreshed", "test-refreshed"],
  );
  const restarted = await nativeModelRuntime({
    authPath: f.authPath,
    modelsPath: null,
  });
  restarted.registerNativeProvider(f.control.native());
  assert.equal((await restarted.getAuth(id))?.auth.apiKey, "test-refreshed");
  await restarted.logout(id);
  assert.equal(readStoredCredential(id, f.authPath), undefined);
});

test("nativeModelRuntime: native concurrent logins persist both providers and pre-abort cannot save", async (t) => {
  const f = await fixture(t);
  const peer = await nativeModelRuntime({
    authPath: f.authPath,
    modelsPath: null,
  });
  const other = { ...f.control.native(), id: "other-local" };
  peer.registerNativeProvider(other);
  await Promise.all([
    f.runtime.login(id, "api_key", {
      signal: new AbortController().signal,
      prompt: async () => "test-key-a",
      notify: () => {},
    }),
    peer.login(other.id, "api_key", {
      signal: new AbortController().signal,
      prompt: async () => "test-key-b",
      notify: () => {},
    }),
  ]);
  assert.equal((await peer.listCredentials()).length, 2);
  await assert.rejects(peer.logout(other.id, { signal: AbortSignal.abort() }));
  assert.equal(readStoredCredential(other.id, f.authPath)?.type, "api_key");
});

test("nativeModelRuntime: unsupported transport fails before native auth resolution", () => {
  for (const version of ["6.28.0", "8.12.1", "unknown"])
    assert.throws(() => requireSupportedTransport(version), /network-blocked/);
  requireSupportedTransport("6.29.1");
});

test("ProviderSettings: public native construction and exclusive ownership on supported runtime", async (t) => {
  if (!bundledTransportPatched(process.versions.undici)) {
    t.skip("Native ambient resolution requires patched Node");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "pispark-production-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = {
    storageDir: root,
    workspaces: {},
    configurations: {},
    resolveSecret: async () => undefined,
  };
  const settings = await ProviderSettings.create(config);
  try {
    assert((await settings.catalog()).providers.length > 30);
    await assert.rejects(ProviderSettings.create(config));
  } finally {
    await settings.close();
  }
  const reopened = await ProviderSettings.create(config);
  await reopened.close();
});

test("ModelDefaults and SessionRuntime: restart selection, native history, independent active sessions and unavailable default retained", async (t) => {
  const f = await fixture(t);
  f.control.automatic = true;
  await writeFile(
    f.authPath,
    JSON.stringify({ [id]: { type: "api_key", key: "test-key" } }),
  );
  await f.runtime.refresh({ allowNetwork: false });
  await f.settings.setDefault({ provider: id, id: "deterministic" });
  const config = {
    storageDir: join(f.root, "sessions"),
    workspaces: { local: f.root },
    configurations: {
      resources: {
        credential: { stored: true as const },
        systemPrompt: "local test",
        tools: [],
      },
    },
    resolveSecret: async () => undefined,
  };
  const sessions = new SessionRuntime(config, f.settings);
  f.owned.push(() => sessions.shutdown());
  const a = await sessions.create({
    workspace: "local",
    configuration: "resources",
  });
  await sessions.start(a.id, "first").completion;
  await f.settings.setDefault({ provider: id, id: "second" });
  const b = await sessions.create({
    workspace: "local",
    configuration: "resources",
  });
  assert.equal(sessions.snapshot(a.id).model?.id, "deterministic");
  assert.equal(b.model?.id, "second");
  await sessions.stop(a.id);
  assert.equal((await sessions.open(a.id)).model?.id, "deterministic");
  const recovered = new ModelDefaults(f.root);
  await recovered.load();
  assert.equal(recovered.value?.id, "second");
  await f.settings.logout(id);
  await assert.rejects(
    sessions.create({ workspace: "local", configuration: "resources" }),
  );
  assert.equal((await f.settings.catalog()).defaultModel?.id, "second");
  assert.equal(sessions.snapshot(b.id).model?.id, "second");
  await assert.rejects(
    f.settings.setDefault({ provider: id, id: "missing" }),
    /provider-unavailable/,
  );
  assert.equal(recovered.value?.id, "second");
});

test("ModelDefaults: atomic save failures preserve previous choice; invalid restart settings fail closed", async (t) => {
  const f = await fixture(t);
  const value = { provider: id, id: "deterministic" };
  await f.defaults.save(value);
  await rm(join(f.root, "settings.json"));
  await mkdir(join(f.root, "settings.json"));
  await assert.rejects(f.defaults.save(null), /provider-storage/);
  assert.deepEqual(f.defaults.value, value);
  await rm(join(f.root, "settings.json"), { recursive: true });
  await writeFile(
    join(f.root, "settings.json"),
    '{"version":1,"defaultModel":{"provider":"bad"}}',
  );
  await assert.rejects(new ModelDefaults(f.root).load(), /provider-storage/);
});

test("ProviderAuth: URL policy rejects executable, insecure and credential-bearing links", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,bad",
    "file:///private",
    "http://example.invalid",
    "https://user:pass@example.invalid",
  ])
    assert.throws(() => safeAuthUrl(value));
  assert.equal(
    safeAuthUrl("https://example.invalid/auth?state=local"),
    "https://example.invalid/auth?state=local",
  );
});

for (const type of ["text", "secret", "manual_code"] as const)
  test(`ProviderAuth: empty ${type} responses reach native provider unchanged`, async (t) => {
    const f = await fixture(t);
    f.control.customLogin = async (interaction) => {
      assert.equal(
        await interaction.prompt({ type, message: "Blank is valid" }),
        "",
      );
    };
    const c = f.auth.start(id, "api_key");
    const p = await current(f.auth, c, type);
    f.auth.respond(c.id, c.token, p.id, "");
    const final = await current(f.auth, c, "secret");
    f.auth.respond(c.id, c.token, final.id, "test-key");
    await eventually(() => f.auth.observe(c.id, c.token).state === "saved");
  });

test("ProviderAuth: empty select IDs are rejected and unoffered values cannot respond", async (t) => {
  const f = await fixture(t);
  f.control.customLogin = async (i) => {
    await i.prompt({
      type: "select",
      message: "Choose",
      options: [{ id: "", label: "Invalid identity" }],
    });
  };
  const c = f.auth.start(id, "api_key");
  await eventually(() => f.auth.observe(c.id, c.token).state === "failed");
});

test("ProviderSettings: drain delayed default write and reject new operations before ownership release", async (t) => {
  const f = await fixture(t);
  let finish!: () => void;
  const gate = new Promise<void>((r) => {
    finish = r;
  });
  const save = f.defaults.save.bind(f.defaults);
  f.defaults.save = async (value) => {
    await gate;
    await save(value);
  };
  let released = false;
  const settings = new ProviderSettings(
    f.runtime,
    f.authPath,
    f.defaults,
    () => true,
    () => {
      released = true;
    },
    false,
    f.stores.deviceId,
  );
  const write = settings.setDefault(null);
  const closing = settings.close();
  await assert.rejects(settings.setDefault(null), /provider-busy/);
  await assert.rejects(settings.logout(id), /provider-busy/);
  await assert.rejects(settings.refresh(id), /provider-busy/);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(released, false);
  finish();
  await write;
  await closing;
  assert.equal(released, true);
});

test("ProviderSettings: admitted refresh/logout drain even when native work ignores cancellation", async (t) => {
  const f = await fixture(t);
  for (const method of ["refresh", "logout"] as const) {
    let finish!: () => void;
    let entered = false;
    let released = false;
    const gate = new Promise<void>((r) => {
      finish = r;
    });
    const original = f.runtime[method].bind(f.runtime);
    Object.defineProperty(f.runtime, method, {
      configurable: true,
      value: async () => {
        entered = true;
        await gate;
        if (method === "refresh") return { aborted: false, errors: new Map() };
      },
    });
    const settings = new ProviderSettings(
      f.runtime,
      f.authPath,
      f.defaults,
      () => true,
      () => {
        released = true;
      },
      false,
      f.stores.deviceId,
    );
    const operation = settings[method](id);
    await eventually(() => entered);
    const closing = settings.close();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(released, false);
    finish();
    await operation;
    await closing;
    assert.equal(released, true);
    Object.defineProperty(f.runtime, method, {
      configurable: true,
      value: original,
    });
  }
});

test("ProviderSettings: malformed/unreadable configured models and native composition errors fail safely", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-model-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "models.json");
  const config = {
    storageDir: join(root, "sessions"),
    providerSettings: { directory: join(root, "providers"), modelsPath: path },
    workspaces: {},
    configurations: {},
    resolveSecret: async () => undefined,
  };
  for (const text of [
    "{PRIVATE_BROKEN",
    JSON.stringify({ providers: { openai: { oauth: "radius" } } }),
  ]) {
    await writeFile(path, text);
    await assert.rejects(
      ProviderSettings.create(config),
      /^Error: provider-configuration$/,
    );
  }
  await rm(path);
  await mkdir(path);
  await assert.rejects(
    ProviderSettings.create(config),
    /^Error: provider-configuration$/,
  );
});

test("ProviderSettings: refresh config/cache failures disable catalog and new sessions until successful recovery", async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.authPath,
    JSON.stringify({ [id]: { type: "api_key", key: "test-key" } }),
  );
  await f.runtime.refresh({ allowNetwork: false });
  const original = f.runtime.refresh.bind(f.runtime);
  f.runtime.refresh = async () => ({
    aborted: false,
    errors: new Map([[id, Error("PRIVATE_CACHE_ERROR")]]),
  });
  await assert.rejects(
    f.settings.refresh(id),
    /^Error: provider-configuration$/,
  );
  await assert.rejects(f.settings.catalog(), /^Error: provider-configuration$/);
  await assert.rejects(
    f.settings.select({ provider: id, id: "deterministic" }),
    /^Error: provider-configuration$/,
  );
  const config = {
    storageDir: join(f.root, "sessions"),
    workspaces: { local: f.root },
    configurations: {
      resources: {
        credential: { stored: true as const },
        systemPrompt: "local",
        tools: [],
      },
    },
    resolveSecret: async () => undefined,
  };
  const sessions = new SessionRuntime(config, f.settings);
  f.owned.push(() => sessions.shutdown());
  await assert.rejects(
    sessions.create({
      workspace: "local",
      configuration: "resources",
      model: { provider: id, id: "deterministic" },
    }),
  );
  f.runtime.refresh = original;
  await f.settings.refresh(id);
  assert.equal(
    (await f.settings.select({ provider: id, id: "deterministic" })).model.id,
    "deterministic",
  );
});

test("ProviderSettings: failed native cache restoration blocks startup without leaking cache contents", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const models = join(root, "models.json");
  await writeFile(models, '{"providers":{}}');
  const directory = join(root, "providers");
  await mkdir(directory);
  await writeFile(
    join(directory, "models-store.json"),
    "{PRIVATE_CACHE_BROKEN",
  );
  await assert.rejects(
    ProviderSettings.create({
      storageDir: join(root, "sessions"),
      providerSettings: { directory, modelsPath: models },
      workspaces: {},
      configurations: {},
      resolveSecret: async () => undefined,
    }),
    /^Error: provider-configuration$/,
  );
});

test("ProviderSettings: malformed configuration on refresh cannot admit built-in fallback; repair recovers", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-config-refresh-"));
  const modelsPath = join(root, "models.json");
  await writeFile(
    modelsPath,
    JSON.stringify({
      providers: {
        openai: { baseUrl: "http://127.0.0.1:1/operator-override" },
      },
    }),
  );
  const settings = await ProviderSettings.create({
    storageDir: join(root, "sessions"),
    providerSettings: { directory: join(root, "providers"), modelsPath },
    workspaces: {},
    configurations: {},
    resolveSecret: async () => undefined,
  });
  t.after(async () => {
    await settings.close();
    await rm(root, { recursive: true, force: true });
  });
  assert.equal(
    settings.runtime.getModels("openai")[0]?.baseUrl,
    "http://127.0.0.1:1/operator-override",
  );
  await writeFile(modelsPath, "{PRIVATE_OVERRIDE_BROKEN");
  await assert.rejects(
    settings.refresh("openai"),
    /^Error: provider-configuration$/,
  );
  await assert.rejects(
    settings.select({ provider: "openai", id: "any-model" }),
    /^Error: provider-configuration$/,
  );
  await assert.rejects(settings.catalog(), /^Error: provider-configuration$/);
  await writeFile(
    modelsPath,
    JSON.stringify({
      providers: {
        openai: { baseUrl: "http://127.0.0.1:1/operator-override" },
      },
    }),
  );
  // No credential, so the native explicit refresh performs no remote catalog request for this provider.
  await settings.refresh("openai");
  assert((await settings.catalog()).providers.length > 30);
});

test("nativeModelRuntime: native host env and stored env reference resolve in explicitly scoped child; source metadata is transparent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-native-env-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixtureUrl = new URL("./fixtures/provider-settings.ts", import.meta.url)
    .href;
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { localProviderSettings } from ${JSON.stringify(fixtureUrl)};
    const f = await localProviderSettings(${JSON.stringify(root)});
    const p = f.control.native();
    f.runtime.registerNativeProvider({ ...p, auth: { apiKey: { ...p.auth.apiKey,
      check: async ({ ctx, credential }) => (credential?.key || await ctx.env('PISPARK_TEST_NATIVE_KEY')) ? {type:'api_key',source:'test host environment'} : undefined,
      resolve: async ({ctx,credential}) => ({auth:{apiKey:credential?.key ?? await ctx.env('PISPARK_TEST_NATIVE_KEY')}})
    } } });
    await f.runtime.refresh({allowNetwork:false});
    assert.equal((await f.runtime.getAuth(p.id)).auth.apiKey, 'test-child-only-key');
    assert.equal((await f.settings.catalog()).providers.find(x=>x.id===p.id).source,'host');
    await f.runtime.login(p.id,'api_key',{signal:new AbortController().signal,prompt:async()=>'$PISPARK_TEST_NATIVE_KEY',notify:()=>{}});
    assert.equal((await f.runtime.getAuth(p.id)).auth.apiKey, 'test-child-only-key');
    assert.equal((await f.settings.catalog()).providers.find(x=>x.id===p.id).source,'stored');
    await f.runtime.logout(p.id);
    assert.equal((await f.settings.catalog()).providers.find(x=>x.id===p.id).source,'host');
    await f.settings.close();
    console.log('native env and shared store passed');
  `,
    ],
    {
      env: {
        ...process.env,
        PISPARK_CONFIG: "",
        PISPARK_TEST_NATIVE_KEY: "test-child-only-key",
      },
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /native env and shared store passed/);
});

test("ProviderAuth: cancel after native credential commit preserves saved-sync-failed without leaking credential", async (t) => {
  const f = await fixture(t);
  let finish!: () => void;
  f.control.checkGate = new Promise<void>((r) => {
    finish = r;
  });
  t.after(() => finish());
  const c = f.auth.start(id, "api_key");
  const prompt = await current(f.auth, c, "secret");
  f.auth.respond(c.id, c.token, prompt.id, "test-committed-before-cancel");
  await eventually(() => f.control.checking);
  assert.equal(readStoredCredential(id, f.authPath)?.type, "api_key");
  f.auth.cancel(c.id, c.token);
  await eventually(
    () => f.auth.observe(c.id, c.token).state === "saved-sync-failed",
  );
  assert.equal(readStoredCredential(id, f.authPath)?.type, "api_key");
  assert.doesNotMatch(
    JSON.stringify(f.auth.observe(c.id, c.token)),
    /test-committed|PRIVATE|cause/,
  );
  finish();
});
