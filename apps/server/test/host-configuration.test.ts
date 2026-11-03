import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundledTransportPatched } from "../src/host-configuration.js";

test("hostConfiguration: actual isolated startup gate, sanitized module failure and public bind refusal", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const module = join(root, "config.mjs");
  const source = new URL("../src/host-configuration.ts", import.meta.url).href;
  const probe = () =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import {hostConfiguration} from ${JSON.stringify(source)}; await hostConfiguration(); console.log('loaded')`,
      ],
      { env: { ...process.env, PISPARK_CONFIG: module }, encoding: "utf8" },
    );
  await writeFile(
    module,
    `export default {storageDir:${JSON.stringify(root)},workspaces:{},configurations:{a:{credential:{secretRef:'explicit'},provider:()=>{throw Error('MUST_NOT_EXECUTE')}}},resolveSecret:async()=>undefined}`,
  );
  const external = probe();
  if (bundledTransportPatched(process.versions.undici))
    assert.equal(external.status, 0);
  else {
    assert.notEqual(external.status, 0);
    assert.match(external.stderr, /Native providers disabled/);
    assert(external.stderr.includes(process.versions.undici ?? "unknown"));
  }
  await writeFile(module, `throw Error('PRIVATE_SENTINEL_SECRET')`);
  const failed = probe();
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Unable to load trusted/);
  assert.doesNotMatch(failed.stderr, /PRIVATE_SENTINEL_SECRET/);
  const bind = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    ],
    {
      env: { ...process.env, HOST: "0.0.0.0", PISPARK_CONFIG: "" },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.notEqual(bind.status, 0);
  assert.match(bind.stderr, /HOST must be literal loopback/);
});
