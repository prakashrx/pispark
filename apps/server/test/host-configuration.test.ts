import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundledTransportPatched } from "../src/host-configuration.js";
import { lockHome, prepareHome, resolveHome } from "../src/home.js";

test("PISPARK_HOME: default ~/.pispark, ~ expansion, absolute paths only", () => {
  assert.equal(resolveHome(undefined), join(homedir(), ".pispark"));
  assert.equal(resolveHome(""), join(homedir(), ".pispark"));
  assert.equal(resolveHome("~/.pispark-dev"), join(homedir(), ".pispark-dev"));
  assert.throws(() => resolveHome("relative/home"), /absolute/);
});

test("data root: created on first start, one server per folder, stale locks replaced", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-home-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = prepareHome(join(root, "data"));
  for (const dir of [paths.chats, paths.personas, paths.providers])
    assert.ok(existsSync(dir));
  const release = lockHome(paths);
  assert.throws(() => lockHome(paths), /Another PiSpark server/);
  release();
  assert.equal(existsSync(join(paths.root, "pispark.lock")), false);
  // A lock left by a process that is gone is replaced.
  const again = lockHome(paths);
  const lock = join(paths.root, "pispark.lock");
  const owner = JSON.parse(readFileSync(lock, "utf8"));
  assert.equal(owner.pid, process.pid);
  again();
});

test("startup: transport gate, first-start Default persona, public bind refusal", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-start-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const index = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const bind = spawnSync(process.execPath, ["--import", "tsx", index], {
    env: { ...process.env, HOST: "0.0.0.0", PISPARK_HOME: root },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.notEqual(bind.status, 0);
  assert.match(bind.stderr, /HOST must be literal loopback/);
  const source = new URL("../src/host-configuration.ts", import.meta.url).href;
  const probe = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import {hostConfiguration} from ${JSON.stringify(source)}; console.log(JSON.stringify(hostConfiguration()))`,
    ],
    { env: { ...process.env, PISPARK_HOME: root }, encoding: "utf8" },
  );
  if (bundledTransportPatched(process.versions.undici)) {
    assert.equal(probe.status, 0, probe.stderr);
    assert.deepEqual(JSON.parse(probe.stdout), { home: root });
  } else {
    assert.notEqual(probe.status, 0);
    assert.match(probe.stderr, /Native providers disabled/);
  }
});
