import { test as base, expect, type TestInfo } from "@playwright/test";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

export async function isolatedHost(info: TestInfo) {
  const root = await mkdtemp(join(tmpdir(), "pispark-browser-restart-"));
  const home = join(root, "home");
  await mkdir(home);
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const baseURL = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  const pids: number[] = [];
  async function start() {
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, "AppData", "Roaming"),
      PORT: String(port),
      PISPARK_DEV_ORIGIN: "",
    };
    for (const key of [
      "SystemRoot",
      "WINDIR",
      "PATH",
      "PATHEXT",
      "TEMP",
      "TMP",
      "COMSPEC",
      // Pi finds Git Bash under %ProgramFiles%; without these it falls back to the first bash.exe on
      // PATH, which on GitHub's Windows image is WSL's (commands then run in Linux, out of reach of Stop).
      "ProgramFiles",
      "ProgramFiles(x86)",
      "ProgramW6432",
      "LOCALAPPDATA",
      "PISPARK_DEBUG_PROCESSES",
    ])
      if (process.env[key]) env[key] = process.env[key];
    child = fork(resolve("../server/test/fixtures/browser-host.ts"), [root], {
      execPath: process.execPath,
      execArgv: ["--import", "tsx"],
      env,
      silent: true,
    });
    pids.push(child.pid!);
    for (const stream of [child.stdout, child.stderr])
      stream?.on("data", (data) => {
        void appendFile(info.outputPath("fixture-child.log"), data);
      });
    await expect
      .poll(async () => {
        if (child?.exitCode !== null)
          throw new Error("Owned fixture child exited");
        try {
          return (await fetch(`${baseURL}/api/health`)).status;
        } catch {
          return 0;
        }
      })
      .toBe(200);
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exit = once(child, "exit");
    child.send("shutdown");
    await exit;
  }
  async function dispose() {
    await stop();
    await rm(root, { recursive: true, force: true });
  }
  return { root, baseURL, port, pids, start, stop, dispose };
}

export const hostedTest = base.extend({
  baseURL: async ({}, use, info) => {
    const host = await isolatedHost(info);
    try {
      await host.start();
      await use(host.baseURL);
    } finally {
      await host.dispose();
    }
  },
});
