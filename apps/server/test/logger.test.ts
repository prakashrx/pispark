import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { correlated, SafeLogger } from "../src/core/logger.js";

test("logger projects only allowlisted fields and preserves independent async correlation", async () => {
  const lines: string[] = [];
  const logger = new SafeLogger({
    sink: async (line) => {
      lines.push(line);
    },
  });
  const first = randomUUID(),
    second = randomUUID();
  await Promise.all(
    [first, second].map((requestId) =>
      correlated({ requestId }, async () => {
        await Promise.resolve();
        logger.event("persona.save", {
          outcome: "failed",
          code: "storage",
          durationMs: 1.8,
          personaId: "SECRET\nforged",
          counts: { skills: Infinity },
          ...({ prompt: "PRIVATE", cause: { token: "TOKEN" } } as {}),
        });
      }),
    ),
  );
  await logger.close();
  assert.deepEqual(
    lines.map((l) => JSON.parse(l).requestId).sort(),
    [first, second].sort(),
  );
  assert(!lines.join("").match(/SECRET|forged|PRIVATE|TOKEN|Infinity/));
  assert.equal(JSON.parse(lines[0]!).durationMs, 2);
});

test("stalled sink bounds queue and shutdown; failures are nonfatal and fallback throttled", async () => {
  let release!: () => void;
  const logger = new SafeLogger({
    sink: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  for (let i = 0; i < 1000; i++) logger.event("session.start");
  assert(logger.pending.records <= 256);
  assert(logger.pending.bytes <= 256 * 1024);
  assert.equal(logger.pending.dropped, 743);
  await logger.close(5);
  assert.equal(logger.pending.records, 0);
  release();
  let warnings = 0;
  const failed = new SafeLogger({
    sink: async () => {
      throw new Error("SECRET");
    },
    fallback: () => {
      warnings++;
    },
  });
  for (let i = 0; i < 20; i++) {
    failed.event("http.failure");
    await Promise.resolve();
  }
  await failed.close();
  assert.equal(warnings, 1);
});

test("file rotation retains only active plus three bounded files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pispark-log-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logger = new SafeLogger({ directory, maxFileBytes: 256 });
  for (let i = 0; i < 20; i++)
    logger.event("persona.save", { counts: { skills: i } });
  await logger.close();
  const files = await readdir(directory);
  assert.equal(files.length, 4);
  for (const file of files) {
    const text = await readFile(join(directory, file), "utf8");
    assert(Buffer.byteLength(text) <= 256);
    for (const line of text.trim().split("\n"))
      assert.equal(JSON.parse(line).event, "persona.save");
  }
});

for (const code of ["EACCES", "ENOSPC"] as const) {
  test(`logger ${code} sink failure drops bounded work without leaking the native cause`, async () => {
    const fallbackArguments: unknown[][] = [];
    const logger = new SafeLogger({
      sink: async () => {
        throw Object.assign(new Error("PRIVATE-PATH AUTH-TOKEN"), {
          code,
          cause: { authorization: "SECRET" },
        });
      },
      fallback: (...args: unknown[]) => {
        fallbackArguments.push(args);
      },
    });
    logger.event("persona.save", { outcome: "failed", code: "storage" });
    await Promise.resolve();
    logger.event("session.failure", { outcome: "failed", code: "storage" });
    await logger.close();
    assert.deepEqual(fallbackArguments, [[]]);
    assert.equal(logger.pending.records, 0);
    assert(logger.pending.dropped > 0);
  });
}

for (const closeFallback of [false, true]) {
  test(`console logger survives a closed output pipe${closeFallback ? " and closed fallback pipe" : ""}`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), "pispark-console-log-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const source = new URL("../src/core/logger.js", import.meta.url).href;
    const script = `import{SafeLogger}from${JSON.stringify(source)};const logger=new SafeLogger();setTimeout(()=>logger.event('host.start'),100);setTimeout(async()=>{await logger.close();process.exit(0)},250);`;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        env: {
          SystemRoot: process.env.SystemRoot,
          HOME: home,
          USERPROFILE: home,
          TEMP: tmpdir(),
          TMP: tmpdir(),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    child.stdout.destroy();
    if (closeFallback) child.stderr.destroy();
    const [exitCode] = await once(child, "exit");
    assert.equal(exitCode, 0, errors);
    assert(!errors.includes("Unhandled") && !errors.includes("EPIPE"));
  });
}
