import { test, expect, type Page } from "@playwright/test";
import { folderButton, newSession, otherFolderLabel, useFolder } from "./ask";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** The screens every size can reach from the sidebar, by address. */
const routes = ["new", "agents", "background", "settings", "settings/providers"] as const;

async function navigate(page: Page, route: string) {
  await page.evaluate((route) => {
    window.location.hash = `/${route}`;
  }, route);
  await expect(page).toHaveURL(new RegExp(`#/${route}$`));
  await expect(page.getByRole("main")).toBeFocused();
}

for (const width of [1920, 3840]) {
  test(`one shell: the same sidebar and top bar on every screen at ${width} CSSpx`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1200 });
    const evidence = process.env.PISPARK_EVIDENCE_DIR ?? info.outputPath("evidence");
    await mkdir(evidence, { recursive: true });
    await page.goto("/#/new");
    await expect(folderButton(page)).toBeVisible();
    const measurements = [];
    for (const route of routes) {
      if (route !== "new") await navigate(page, route);
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(() => {
        const box = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) return undefined;
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        };
        return {
          route: window.location.hash,
          sidebar: box('aside[aria-label="Sidebar"]'),
          topbar: box(".topbar"),
          // Main is the only scroll: the page itself never scrolls.
          pageScrolls: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
        };
      });
      measurements.push(metrics);
      expect(metrics.sidebar).toEqual({ x: 0, y: 0, width: 272, height: 1200 });
      expect(metrics.pageScrolls).toBe(false);
      // Agents heads its own content; every other screen names itself in the bar.
      if (metrics.topbar) expect(metrics.topbar).toMatchObject({ x: 272, y: 0, width: width - 272, height: 48 });
      else expect(metrics.route).toBe("#/agents");
      await page.screenshot({ path: resolve(evidence, `shell-${width}-${route.replace("/", "-")}.png`), animations: "disabled" });
    }
    // The New session composer keeps a reading width in the middle of the screen.
    await navigate(page, "new");
    const composer = (await page.getByRole("form", { name: "New session" }).boundingBox())!;
    expect(composer.width).toBeLessThanOrEqual(704);
    expect(Math.abs(composer.x + composer.width / 2 - (272 + (width - 272) / 2))).toBeLessThan(2);
    await writeFile(resolve(evidence, `shell-metrics-${width}.json`), JSON.stringify(measurements, null, 2));
  });
}

test("the new session's draft and choices survive other screens, history and hiding the sidebar; a reply stays its own", async ({
  page,
}) => {
  await page.goto("/#/new");
  await expect(page.getByRole("button", { name: "Start session", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("Open a session to reply to");
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  const reply = page.getByRole("textbox", { name: /Reply to session/ });
  await expect(reply).toBeVisible();
  await reply.fill("Independent session follow-up");
  const session = page.url();

  await newSession(page);
  await expect(ask).toHaveText("");
  await ask.fill("Unsent question");
  await useFolder(page);
  async function retained() {
    await navigate(page, "new");
    await expect(ask).toHaveText("Unsent question");
    await expect(page.getByRole("button", { name: otherFolderLabel, exact: true })).toBeVisible();
  }
  for (const route of ["settings", "agents", "background"]) {
    await navigate(page, route);
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    await expect(page.getByRole("button", { name: "Show sidebar" })).toBeFocused();
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toHaveCount(0);
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await expect(page.getByRole("button", { name: "Hide sidebar" })).toBeFocused();
    await retained();
  }
  // Back and forward go through the same screens, focus starting on each.
  await page.goBack();
  await expect(page).toHaveURL(/#\/background$/);
  await expect(page.getByRole("main")).toBeFocused();
  await page.goForward();
  await expect(page).toHaveURL(/#\/new$/);
  await expect(ask).toHaveText("Unsent question");

  await page.goto(session);
  await expect(reply).toHaveText("Independent session follow-up");
  await reply.fill("Changed reply only");
  await newSession(page);
  await expect(ask).toHaveText("Unsent question");
});

test("the New session composer stays typeable and its controls inside it at every width", async ({ page }) => {
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/new");
    const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
    const question = `Question at ${width}`;
    // Responsive placement can remount the composer just after the width changes: type until it holds,
    // then check the draft and geometry.
    await expect(async () => {
      await ask.fill(question);
      await expect(ask).toHaveText(question, { timeout: 1000 });
    }).toPass();
    await expect.poll(async () => (await ask.boundingBox())?.width ?? 0).toBeGreaterThan(200);
    const form = page.getByRole("form", { name: "New session" });
    const start = page.getByRole("button", { name: "Start session", exact: true });
    await expect.poll(async () => {
      const surface = await form.boundingBox();
      const run = await start.boundingBox();
      return !!surface && !!run && run.x + run.width <= surface.x + surface.width &&
        run.y + run.height <= surface.y + surface.height;
    }).toBe(true);
    // The choices are reachable and their picker returns focus.
    await folderButton(page).click();
    await expect(page.getByRole("combobox", { name: "Search Working folder" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(folderButton(page)).toBeFocused();
    for (const route of [...routes.slice(1), "new"]) {
      await navigate(page, route);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
