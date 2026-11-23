import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localProviderSettings } from "./fixtures/provider-settings.js";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";

import {
  registerApiProvider,
  resetApiProviders,
} from "@earendil-works/pi-ai/compat";
import { ProviderSettings } from "../src/core/runtime/provider-settings.js";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { AuthProviderControl } from "./fixtures/provider-settings.js";
import { LocalProviderControl, eventually } from "./fixtures/local-provider.js";
import {
  nativeModelRuntime,
  guardModelDispatch,
} from "../src/core/runtime/native-model-runtime.js";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Setup } from "../src/core/agents/resolve.js";
import { createSessionServices } from "../src/core/runtime/configuration.js";

const provider = "pispark-local-test";
for (const kind of ["modelOverrides", "models"] as const)
  test(`SessionRuntime: native ${kind} headers reach session dispatch without leaking into projections/history`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "pispark-model-headers-"));
    const modelsPath = join(root, "models.json");
    const definition = {
      id: "deterministic",
      headers: {
        "x-route": "PRIVATE_MODEL_ROUTE",
        "X-Only-Model": "PRIVATE_MODEL_ONLY",
      },
    };
    await writeFile(
      modelsPath,
      JSON.stringify({
        providers: {
          [provider]: {
            baseUrl: "http://127.0.0.1",
            api: "openai-completions",
            headers: {
              "X-Route": "PRIVATE_PROVIDER_ROUTE",
              "X-Only-Provider": "PRIVATE_PROVIDER_ONLY",
            },
            ...(kind === "modelOverrides"
              ? {
                  modelOverrides: {
                    deterministic: { headers: definition.headers },
                  },
                }
              : {
                  models: [definition],
                  modelOverrides: {
                    deterministic: {
                      headers: { "X-ROUTE": "PRIVATE_OVERRIDE_ROUTE" },
                    },
                  },
                }),
          },
        },
      }),
    );
    const f = await localProviderSettings(root, undefined, modelsPath);
    f.control.automatic = true;
    const sessions = new SessionRuntime(
      { home: join(root, "pispark") },
      f.settings,
    );
    t.after(async () => {
      await sessions.shutdown();
      await f.settings.close();
      await rm(root, { recursive: true, force: true });
    });
    await writeFile(
      f.authPath,
      JSON.stringify({ [provider]: { type: "api_key", key: "test-key" } }),
    );
    await f.runtime.refresh({ allowNetwork: false });
    const choice = { provider, id: "deterministic" };
    await f.settings.setDefault(choice);
    const selected = await f.settings.select(choice);
    const nativeHeaders = (await f.runtime.getAuth(selected.model))?.auth
      .headers;
    assert.equal(nativeHeaders?.["x-route"], "PRIVATE_MODEL_ROUTE");
    assert.equal(
      nativeHeaders?.["X-Route"],
      undefined,
      "native case-insensitive model precedence",
    );
    const a = await sessions.create({
      folder: root,
    });
    assert.equal(
      (await sessions.start(a.id, "first").completion).outcome,
      "completed",
    );
    assert.deepEqual(f.control.requests.at(-1)?.headers, nativeHeaders);
    await f.settings.setDefault({ provider, id: "second" });
    assert.equal(sessions.session(a.id).model?.id, "deterministic");
    const b = await sessions.create({
      folder: root,
    });
    assert.equal(b.model?.id, "second");
    await sessions.stop(a.id);
    assert.equal((await sessions.open(a.id)).model?.id, "deterministic");
    assert.equal(
      (await sessions.start(a.id, "reopened").completion).outcome,
      "completed",
    );
    assert.deepEqual(f.control.requests.at(-1)?.headers, nativeHeaders);
    // Settings refresh must not mutate an admitted session's request configuration.
    const changed = (await readFile(modelsPath, "utf8")).replace(
      "PRIVATE_MODEL_ROUTE",
      "PRIVATE_CHANGED_ROUTE",
    );
    await writeFile(modelsPath, changed);
    await f.runtime.refresh({ allowNetwork: false });
    await sessions.start(a.id, "stable active config").completion;
    assert.deepEqual(f.control.requests.at(-1)?.headers, nativeHeaders);
    await sessions.stop(a.id);
    await sessions.open(a.id);
    await sessions.start(a.id, "new admission uses current config").completion;
    assert.equal(
      f.control.requests.at(-1)?.headers?.["x-route"],
      "PRIVATE_CHANGED_ROUTE",
    );
    await writeFile(modelsPath, "{PRIVATE_BROKEN_CONFIG");
    await assert.rejects(
      sessions.create({ folder: root }),
    );
    const message = "admitted despite broken file";
    const requestCount = f.control.requests.length;
    assert.equal((await sessions.start(a.id, message).completion).outcome, "completed");
    const admitted = f.control.requests.slice(requestCount).find(({ context }) => {
      const user = context.messages.findLast((entry) => entry.role === "user");
      return user?.content === message || (Array.isArray(user?.content) &&
        user.content.some((part) => part.type === "text" && part.text === message));
    });
    assert.ok(admitted, "the already admitted session dispatched the requested turn");
    assert.equal(admitted.headers?.["x-route"], "PRIVATE_CHANGED_ROUTE");
    await sessions.stop(a.id);
    await assert.rejects(sessions.open(a.id));
    const publicValues = JSON.stringify([
      (await f.settings.catalog()).providers.find((p) => p.id === provider),
      sessions.list(),
      sessions.session(b.id),
      sessions.session(b.id),
    ]);
    assert.doesNotMatch(
      publicValues,
      /PRIVATE_|"headers"\s*:|"baseUrl"\s*:|test-key/,
    );
    const session = join(root, "pispark", "sessions", a.id);
    for (const file of await readdir(session)) {
      if (file === "session.json" || file.endsWith(".jsonl"))
        assert.doesNotMatch(
          await readFile(join(session, file), "utf8"),
          /PRIVATE_|"headers"\s*:|test-key/,
        );
    }
  });

// Public API transport substitution is test-only; every request stays in-process.
for (const kind of ["config-only", "builtin", "api-changing"] as const)
  test(`SessionRuntime: ${kind} provider uses native model request config and public dispatch guard`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "pispark-native-request-"));
    const modelsPath = join(root, "models.json");
    const source = new AuthProviderControl();
    const recorder = new LocalProviderControl();
    recorder.automatic = true;
    const id =
      kind === "builtin"
        ? "openai"
        : kind === "api-changing"
          ? provider
          : "config-only-test";
    const modelId = kind === "builtin" ? "gpt-4o" : "deterministic";
    const api = "openai-responses" as const;
    await writeFile(
      modelsPath,
      JSON.stringify({
        providers: {
          [id]: {
            baseUrl: "http://127.0.0.1:1/never-network",
            apiKey: "test-native-key",
            api,
            headers: {
              "X-Route": "PRIVATE_PROVIDER_ROUTE",
              "X-Provider": "PRIVATE_PROVIDER",
            },
            ...(kind === "builtin"
              ? {
                  modelOverrides: {
                    [modelId]: {
                      headers: { "x-route": "PRIVATE_MODEL_ROUTE" },
                    },
                  },
                }
              : {
                  models: [
                    {
                      id: modelId,
                      api,
                      headers: { "x-route": "PRIVATE_MODEL_ROUTE" },
                    },
                  ],
                }),
          },
        },
      }),
    );
    const configuration = {
      home: root,
      providerSettings: {
        modelsPath,
        providers:
          kind === "api-changing"
            ? [source.native]
            : kind === "builtin"
              ? [
                  () => ({
                    ...builtinProviders().find((p) => p.id === id)!,
                    stream: recorder.provider().stream,
                    streamSimple: recorder.provider().streamSimple,
                  }),
                ]
              : [],
      },
    };
    const settings = await ProviderSettings.create(configuration);
    const sessions = new SessionRuntime(configuration, settings);
    t.after(async () => {
      await sessions.shutdown();
      await settings.close();
      resetApiProviders();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    });
    const choice = { provider: id, id: modelId };
    const a = await sessions.create({
      folder: root,
      model: choice,
    });
    const fake = recorder.provider();
    registerApiProvider({
      api,
      stream: fake.stream,
      streamSimple: fake.streamSimple,
    });
    const result = await sessions.start(a.id, "native transport config")
      .completion;
    assert.equal(result.outcome, "completed");
    assert.equal(
      source.requests.length,
      0,
      "API-changing definition bypasses original native stream",
    );
    const request = recorder.requests.at(-1)!;
    assert.equal(request.model.provider, id);
    assert.equal(request.apiKey, "test-native-key");
    assert.equal(request.model.baseUrl, "http://127.0.0.1:1/never-network");
    assert.equal(request.headers?.["x-route"], "PRIVATE_MODEL_ROUTE");
    assert.equal(request.headers?.["X-Route"], undefined);
    assert.equal(request.headers?.["X-Provider"], "PRIVATE_PROVIDER");
    // A changed model endpoint cannot silently differ from settings admission.
    await sessions.stop(a.id);
    const before = await readFile(modelsPath, "utf8");
    await writeFile(
      modelsPath,
      before.replace("never-network", "changed-endpoint"),
    );
    await assert.rejects(sessions.open(a.id));
    assert.equal(recorder.requests.length, 1);
  });

for (const method of ["stream", "streamSimple"] as const)
  for (const phase of ["auth", "headers"] as const)
    test(`guardModelDispatch: ${method} cancellation during ${phase} prevents underlying dispatch and preserves peer runtime`, async (t) => {
      const root = await mkdtemp(join(tmpdir(), "pispark-dispatch-guard-"));
      const f = await localProviderSettings(root);
      const peer = await nativeModelRuntime({
        authPath: f.authPath,
        modelsPath: null,
      });
      peer.registerNativeProvider(f.control.native());
      f.control.automatic = true;
      t.after(async () => {
        await f.settings.close();
        await rm(root, { recursive: true, force: true });
      });
      await writeFile(
        f.authPath,
        JSON.stringify({ [provider]: { type: "api_key", key: "test-key" } }),
      );
      let cancelled = false;
      let entered = false;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      t.after(() => release());
      if (phase === "auth") {
        const original = f.runtime.getAuth.bind(f.runtime);
        t.mock.method(
          f.runtime,
          "getAuth",
          async (...args: Parameters<typeof original>) => {
            entered = true;
            await gate;
            return original(...args);
          },
        );
      }
      let transforms = 0;
      guardModelDispatch(f.runtime, () => {
        if (cancelled) throw new DOMException("aborted", "AbortError");
      });
      const model = f.runtime.getModel(provider, "deterministic")!;
      const pending = f.runtime[method](
        model,
        { messages: [] },
        {
          transformHeaders: async (headers) => {
            transforms++;
            if (phase === "headers") {
              entered = true;
              await gate;
            }
            return { ...headers, "X-Extension": "test-extension-transform" };
          },
        },
      ).result();
      await eventually(() => entered);
      cancelled = true;
      release();
      assert.equal(
        (await pending).stopReason,
        "error",
        "native lazyStream settles guard exception without dispatch",
      );
      assert.equal(f.control.requests.length, 0);
      assert.equal(
        transforms,
        1,
        "existing async header transform chained once",
      );
      await peer[method](model, { messages: [] }).result();
      assert.equal(f.control.requests.length, 1, "peer runtime is independent");
      cancelled = false;
      await f.runtime[method](
        model,
        { messages: [] },
        {
          transformHeaders: (headers) => ({
            ...headers,
            "X-Extension": "kept",
          }),
        },
      ).result();
      assert.equal(f.control.requests.at(-1)?.headers?.["X-Extension"], "kept");
    });

test("SessionRuntime: managed native config cancellation before compaction dispatches nothing; current config resumes natively", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-managed-compaction-"));
  const modelsPath = join(root, "models.json");
  const config = (contextWindow: number) =>
    JSON.stringify({
      providers: {
        [provider]: {
          modelOverrides: {
            deterministic: {
              contextWindow,
              headers: { "X-Route": "PRIVATE_COMPACTION_ROUTE" },
            },
          },
        },
      },
    });
  await writeFile(modelsPath, config(100_000));
  const f = await localProviderSettings(root, undefined, modelsPath);
  f.control.automatic = true;
  await writeFile(
    f.authPath,
    JSON.stringify({ [provider]: { type: "api_key", key: "test-key" } }),
  );
  await f.runtime.refresh({ allowNetwork: false });
  const home = join(root, "pispark");
  const sessions = new SessionRuntime({ home }, f.settings);
  t.after(async () => {
    await sessions.shutdown();
    await f.settings.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const request = {
    folder: root,
    model: { provider, id: "deterministic" },
  };
  const a = await sessions.create(request);
  for (let i = 0; i < 2; i++)
    await sessions.start(a.id, "history".repeat(8000)).completion;
  await sessions.stop(a.id);
  const dir = join(home, "sessions", a.id);
  const native = join(
    dir,
    (await readdir(dir)).find((name) => name.endsWith(".jsonl"))!,
  );
  const entries = (await readFile(native, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const last = entries.findLast((entry) => entry.message?.role === "assistant");
  // Past Pi's own threshold in an 8,192 window, under PiSpark's budget (5,734): Pi compacts inside the run.
  last.message.usage.input = 5000;
  last.message.usage.totalTokens = 5001;
  await writeFile(
    native,
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  await writeFile(modelsPath, config(8192));
  await f.runtime.refresh({ allowNetwork: false });
  await sessions.open(a.id);
  let entered = false;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  t.after(() => release());
  const original = ModelRuntime.prototype.checkAuth;
  t.mock.method(ModelRuntime.prototype, "hasConfiguredAuth", () => false);
  t.mock.method(
    ModelRuntime.prototype,
    "checkAuth",
    async function (this: ModelRuntime, id: string) {
      entered = true;
      await gate;
      return original.call(this, id);
    },
  );
  const before = f.control.requests.length;
  const run = sessions.start(a.id, "cancel before compaction");
  await eventually(() => entered);
  const cancellation = sessions.cancel(a.id);
  release();
  await cancellation;
  assert.equal((await run.completion).outcome, "cancelled");
  assert.equal(f.control.requests.length, before);
  t.mock.restoreAll();
  await sessions.stop(a.id);
  await sessions.open(a.id);
  assert.equal(
    (await sessions.start(a.id, "positive compaction").completion).outcome,
    "completed",
  );
  assert(f.control.requests.length > before + 1);
  assert(
    f.control.requests
      .slice(before)
      .every((r) => r.headers?.["X-Route"] === "PRIVATE_COMPACTION_ROUTE"),
  );
  assert.match(await readFile(native, "utf8"), /"type":"compaction"/);
  const peer = await sessions.create(request);
  assert.equal(
    (await sessions.start(peer.id, "peer unaffected").completion).outcome,
    "completed",
  );
});

test("createSessionServices: independently mutable managed runtimes share only explicit native credential persistence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-independent-models-"));
  const f = await localProviderSettings(root);
  t.after(async () => {
    await f.settings.close();
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(
    f.authPath,
    JSON.stringify({ [provider]: { type: "api_key", key: "test-stored" } }),
  );
  await f.runtime.refresh({ allowNetwork: false });
  const selected = await f.settings.select({ provider, id: "deterministic" });
  const setup: Setup = {
    layers: [], items: [], tools: [], settings: {}, instructions: [], skillDirs: [],
    prompts: [], extensionPaths: [], mcpServers: {}, toolsOn: [], toolsOff: [], fingerprint: "", routines: [], holds: [],
  };
  const services = (agentDir: string) =>
    createSessionServices({
      setup,
      cwd: root,
      agentDir,
      managed: selected,
      admission: { valid: () => true, beforeRun: async () => {}, beforeSettle: async () => {}, beforeProviderDispatch: () => {} },
      host: { views: { bind: () => () => {} } },
    });
  const a = await services(join(root, "agent-a"));
  const b = await services(join(root, "agent-b"));
  t.after(() => {
    a.resourceLoader.getExtensions().runtime.invalidate("test cleanup");
    b.resourceLoader.getExtensions().runtime.invalidate("test cleanup");
  });
  assert.notEqual(a.modelRuntime, b.modelRuntime);
  assert.notEqual(a.modelRuntime, f.runtime);
  await a.modelRuntime.setRuntimeApiKey(provider, "test-runtime-only");
  assert.equal(
    (await a.modelRuntime.getAuth(a.model))?.auth.apiKey,
    "test-runtime-only",
  );
  assert.equal(
    (await b.modelRuntime.getAuth(b.model))?.auth.apiKey,
    "test-stored",
  );
  assert.equal((await f.runtime.getAuth(provider))?.auth.apiKey, "test-stored");
});

test("a rejected configuration save cannot change the next dispatch or the restored thinking level", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-config-save-"));
  const control = new AuthProviderControl();
  control.automatic = true;
  const native = control.native;
  control.native = () => {
    const p = native();
    return { ...p, getModels: () => p.getModels().map(m => ({ ...m, reasoning: true })) };
  };
  const f = await localProviderSettings(root, control);
  const sessions = new SessionRuntime({ home: join(root, "pispark") }, f.settings);
  t.after(async () => {
    await sessions.shutdown();
    await f.settings.close();
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(f.authPath, JSON.stringify({ [provider]: { type: "api_key", key: "test-key" } }));
  const original = { provider, id: "deterministic" }, replacement = { provider, id: "second" };
  const { id } = await sessions.create({ folder: root, model: original });
  assert.equal((await sessions.configure(id, { thinking: "low" })).thinking?.level, "low");
  await sessions.start(id, "before change").completion;
  for (const change of [{ model: replacement, thinking: "high" as const }, { thinking: "high" as const }]) {
    t.mock.method(sessions["storage"], "write", () => { throw new Error("injected save failure"); }, { times: 1 });
    await assert.rejects(sessions.configure(id, change), { code: "storage" });
    await sessions.ensure(id);
    assert.deepEqual(sessions.session(id).model, original);
    assert.equal(sessions.session(id).thinking?.level, "low");
    assert.equal((await sessions.start(id, "after rejected change").completion).outcome, "completed");
    assert.equal(control.requests.at(-1)?.model.id, original.id);
  }
  await sessions.configure(id, { model: replacement, thinking: "high" });
  await sessions.stop(id);
  assert.equal((await sessions.open(id)).thinking?.level, "high");
  await sessions.start(id, "after successful retry").completion;
  assert.equal(control.requests.at(-1)?.model.id, replacement.id);
});

test("a refreshed catalog is available to open, new and reopened sessions without loading implicit model config", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-refresh-"));
  await writeFile(join(root, "models.json"), "{not an explicitly configured file");
  const control = new AuthProviderControl();
  const original = control.native;
  let networkReads = 0;
  let switching: (() => void) | undefined;
  let resume: Promise<void> | undefined;
  control.native = () => {
    const base = original();
    const initial = base.getModels();
    const discovered = { ...initial[0]!, id: "discovered", name: "New model" };
    let models = initial;
    return {
      ...base,
      getModels: () => models,
      async refreshModels({ allowNetwork, stored, publish }) {
        if (allowNetwork) networkReads++;
        else if (resume) { switching?.(); await resume; }
        if (allowNetwork || stored?.models.some(m => m.id === discovered.id)) {
          const next = [...initial, discovered];
          await publish({
            ...(allowNetwork && { persist: { models: next } }),
            update: () => { models = next; },
          });
        }
      },
    };
  };
  const f = await localProviderSettings(root, control);
  const sessions = new SessionRuntime({ home: join(root, "pispark") }, f.settings);
  t.after(async () => {
    await sessions.shutdown();
    await f.settings.close();
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(f.authPath, JSON.stringify({ [provider]: { type: "api_key", key: "test-key" } }));
  const selected = { provider, id: "discovered" };
  const warm = await sessions.create({ folder: root, model: { provider, id: "deterministic" } });
  await assert.rejects(sessions.configure(warm.id, { model: selected }), /model-unavailable/);
  assert.equal(sessions.session(warm.id).model?.id, "deterministic");
  await f.settings.refresh(provider);
  const reached = new Promise<void>(resolve => { switching = resolve; });
  let release!: () => void;
  resume = new Promise<void>(resolve => { release = resolve; });
  const pending = sessions.configure(warm.id, { model: selected });
  await reached;
  try {
    // A second change asked for while the first is applied waits for it.
    assert.deepEqual((await sessions.configure(warm.id, { thinking: "low" })).pending, { thinking: "low" });
    assert.throws(() => sessions.start(warm.id, "while switching"), /busy/);
    sessions.rename(warm.id, "Renamed while switching");
  } finally {
    release();
    resume = undefined;
  }
  assert.equal((await pending).model?.id, selected.id);
  await eventually(() => sessions.session(warm.id).pending === undefined);
  assert.equal(sessions.session(warm.id).model?.id, selected.id);
  assert.equal(sessions.session(warm.id).title, "Renamed while switching");
  assert.equal((await sessions.create({ folder: root, model: selected })).model?.id, selected.id);
  await sessions.stop(warm.id);
  assert.equal((await sessions.open(warm.id)).model?.id, selected.id);
  assert.equal(networkReads, 1);
});
