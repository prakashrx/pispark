import { test, expect } from "@playwright/test";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

// This harness owns its child, port, HOME and state; no restart/control endpoint exists.
test("skill reference directory editing survives an actual fixture backend process restart", async ({
  browser,
}, info) => {
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
      PISPARK_CONFIG: "",
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
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  try {
    await start();
    await page.goto("/#/workspace");
    await expect(
      page.getByRole("heading", { name: "Start a chat", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No chats yet.", { exact: true }),
    ).toBeVisible();
    for (const width of [390, 1920, 3840]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
      await page.screenshot({
        path: info.outputPath(`blank-chat-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/#/persona");
    await page
      .getByRole("textbox", { name: "New persona name", exact: true })
      .fill("Restart skill editor");
    await page
      .getByRole("textbox", { name: "New persona name", exact: true })
      .press("Enter");
    await expect(
      page.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("Restart skill editor");
    const ref = JSON.parse(
      await page
        .getByRole("combobox", { name: "Choose a persona", exact: true })
        .inputValue(),
    );
    for (const name of ["first", "second"]) {
      const directory = join(root, "personas", ref.path, "skills", name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "SKILL.md"),
        `---\nname: ${name}\ndescription: Restart supporting fixture\n---\nRead support.txt`,
      );
      await writeFile(join(directory, "support.txt"), `Support ${name}`);
    }
    await page.getByRole("button", { name: "Add skill", exact: true }).click();
    await page
      .locator("details")
      .filter({
        has: page.getByRole("textbox", {
          name: "Skill 1 reference name",
          exact: true,
          includeHidden: true,
        }),
      })
      .locator("summary")
      .click();
    await page
      .getByRole("textbox", { name: "Skill 1 reference name", exact: true })
      .fill("review");
    await page
      .getByRole("textbox", { name: "Skill folder 1", exact: true })
      .fill("skills/first");
    await page.getByText("Preview", { exact: true }).click();
    await page
      .getByRole("button", { name: "Check changes", exact: true })
      .click();
    await expect(
      page.getByText("Restart supporting fixture", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Save persona", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: /^Saved$/ }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Skill folder 1", exact: true })
      .fill("skills/second");
    await page
      .getByRole("button", { name: "Save persona", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: /^Saved$/ }),
    ).toBeVisible();
    const before = await (
      await context.request.post(`${baseURL}/api/personas/read`, {
        data: { ref },
      })
    ).json();
    await stop();
    await start();
    expect(pids[0]).not.toBe(pids[1]);
    await page.reload();
    await page
      .getByRole("combobox", { name: "Choose a persona", exact: true })
      .selectOption(JSON.stringify(ref));
    await expect(
      page.getByRole("textbox", {
        name: "Skill folder 1",
        exact: true,
      }),
    ).toHaveValue("skills/second");
    const after = await (
      await context.request.post(`${baseURL}/api/personas/read`, {
        data: { ref },
      })
    ).json();
    expect(after.definition).toEqual(before.definition);
    expect(after.revision).toBe(before.revision);
    await writeFile(
      info.outputPath("restart-evidence.json"),
      JSON.stringify(
        { pids, port, definitionAndRevisionPreserved: true },
        null,
        2,
      ),
    );
  } catch (error) {
    await page.screenshot({
      path: info.outputPath("failure.png"),
      fullPage: true,
    });
    await writeFile(
      info.outputPath("failure-dom.txt"),
      await page.locator("main").innerText(),
    );
    throw error;
  } finally {
    await context.close();
    await stop();
    await rm(root, { recursive: true, force: true });
  }
});
