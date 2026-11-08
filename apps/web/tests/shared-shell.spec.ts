import { test, expect, type Page } from "@playwright/test";
import { folderButton, otherFolderLabel, useFolder } from "./ask";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const routes = [
  "workspace",
  "settings",
  "providers",
  "persona",
  "sources",
] as const;

async function navigate(page: Page, route: string) {
  await page.evaluate((route) => {
    window.location.hash = `/${route}`;
  }, route);
  await expect(page).toHaveURL(new RegExp(`#/${route}$`));
  await expect(page.getByRole("main")).toBeFocused();
}

for (const width of [1920, 3840]) {
  test(`common shell geometry and computed presentation at ${width} CSSpx`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1200 });
    const evidence =
      process.env.PISPARK_EVIDENCE_DIR ?? info.outputPath("evidence");
    await mkdir(evidence, { recursive: true });
    await page.goto("/#/workspace");
    await expect(
      folderButton(page),
    ).toBeVisible();
    // Ask recedes once a chat is open; measure after the initial selection settles.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            !!localStorage.getItem("pispark-session") ||
            document.body.innerText.includes("No chats yet."),
        ),
      )
      .toBe(true);
    const measurements = [];
    for (const route of routes) {
      if (route !== "workspace") await navigate(page, route);
      await page.evaluate(() => document.fonts.ready);
      // Settle CSS transitions (e.g. Ask receding) so computed styles are final.
      await page.evaluate(() =>
        document
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .forEach((animation) => animation.finish()),
      );
      const metrics = await page.evaluate(() => {
        const measure = (element: Element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            tag: element.tagName,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            presentation: Object.fromEntries(
              [
                "font-family",
                "font-size",
                "font-weight",
                "line-height",
                "color",
                "background-color",
                "border-color",
                "border-width",
                "border-radius",
                "padding",
                "margin",
                "gap",
                "box-shadow",
                "max-width",
                "display",
              ].map((property) => [property, style.getPropertyValue(property)]),
            ),
          };
        };
        const header = document.querySelector(".global-header")!;
        const sidebar = document.querySelector(".app-sidebar")!;
        const brand = document.querySelector(".header-brand")!;
        const composer = document.querySelector('[aria-label="New chat"]')!;
        return {
          route: window.location.hash,
          header: measure(header),
          sidebar: measure(sidebar),
          brand: measure(brand),
          composer: measure(composer),
          controls: [
            ...composer.querySelectorAll("input, button, span, svg"),
          ].map(measure),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      measurements.push(metrics);
      expect(metrics.header).toMatchObject({
        x: 272,
        y: 0,
        width: width - 272,
        height: 64,
      });
      expect(metrics.sidebar).toMatchObject({
        x: 0,
        y: 0,
        width: 272,
        height: 1200,
      });
      expect(metrics.brand.height).toBe(64);
      expect(metrics.composer.x).toBe(292);
      expect(metrics.composer.width).toBe(width - 272 - 40);
      expect(width - metrics.composer.x - metrics.composer.width).toBe(20);
      expect(metrics.composer.presentation["max-width"]).toBe("none");
      expect(metrics.overflow).toBe(false);
      const { route: _route, ...chrome } = metrics;
      const { route: _baselineRoute, ...baseline } = measurements[0];
      expect(chrome).toEqual(baseline);
      await page.screenshot({
        path: resolve(evidence, `after-${width}-${route}.png`),
        animations: "disabled",
      });
    }
    await writeFile(
      resolve(evidence, `shell-metrics-${width}.json`),
      JSON.stringify(measurements, null, 2),
    );
  });
}

test("one global Ask retains draft and all selectors through routes, history and collapse; reply stays independent", async ({
  page,
}) => {
  await page.goto("/#/workspace");
  await expect(
    page.getByRole("button", { name: "Start chat", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  const ask = page.getByRole("textbox", { name: "Ask anything" });
  const mountedAsk = await ask.elementHandle();
  await ask.fill("Open a chat to reply to");
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: /Reply to chat/ }),
  ).toBeVisible();
  await expect(ask).toHaveValue("");
  await ask.fill("Persistent global question");
  await page
    .getByRole("textbox", { name: /Reply to chat/ })
    .fill("Independent session follow-up");
  await useFolder(page);
  await page
    .getByRole("button", {
      name: "Persona: Default",
    })
    .click();
  await page.keyboard.press("Escape");
  async function retained() {
    await expect(ask).toHaveValue("Persistent global question");
    expect(
      await mountedAsk!.evaluate(
        (el) => el === document.querySelector('[aria-label="Ask anything"]'),
      ),
    ).toBe(true);
    for (const label of [otherFolderLabel, "Persona: Default"]) {
      await expect(
        page.getByRole("button", { name: label, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByRole("form", { name: "New chat" })).toHaveCount(1);
  }
  for (const route of ["settings", "persona", "sources", "workspace"]) {
    await navigate(page, route);
    await retained();
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(
      page.getByRole("button", { name: "Expand sidebar" }),
    ).toBeFocused();
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await retained();
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(
      page.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeFocused();
    await retained();
  }
  for (const route of ["sources", "persona", "settings", "workspace"]) {
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`#/${route}$`));
    await expect(page.getByRole("main")).toBeFocused();
    await retained();
  }
  for (const route of ["settings", "persona", "sources", "workspace"]) {
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`#/${route}$`));
    await expect(page.getByRole("main")).toBeFocused();
    await retained();
  }
  const reply = page.getByRole("textbox", { name: /Reply to chat/ });
  await expect(reply).toHaveValue("Independent session follow-up");
  await reply.fill("Changed reply only");
  await retained();
  await navigate(page, "settings");
  await expect(
    page.getByRole("button", { name: otherFolderLabel, exact: true }),
  ).toBeVisible();
});

test("narrow shell preserves Ask across routes and keyboard sidebar toggles", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/workspace");
  const ask = page.getByRole("textbox", { name: /Ask anything/ });
  await ask.fill("Mobile global draft");
  for (const route of routes) {
    if (route !== "workspace") await navigate(page, route);
    await expect(ask).toHaveValue("Mobile global draft");
    await page.getByRole("button", { name: "Collapse sidebar" }).focus();
    await page.keyboard.press("Control+b");
    await expect(
      page.getByRole("button", { name: "Expand sidebar" }),
    ).toBeFocused();
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeFocused();
    await folderButton(page).click();
    await expect(
      page.getByRole("combobox", { name: "Search Working folder" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      folderButton(page),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("Ask remains typeable and controls stay inside its surface at mobile/tablet widths", async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/workspace");
    for (const route of routes) {
      if (route !== "workspace") await navigate(page, route);
      const ask = page.getByRole("textbox", { name: /Ask anything/ });
      await ask.fill(`Question at ${width}`);
      expect((await ask.boundingBox())!.width).toBeGreaterThan(100);
      const surface = await page
        .getByRole("form", { name: "New chat" })
        .boundingBox();
      const run = await page
        .getByRole("button", { name: "Start chat", exact: true })
        .boundingBox();
      expect(run!.x + run!.width).toBeLessThanOrEqual(
        surface!.x + surface!.width,
      );
      expect(run!.y + run!.height).toBeLessThanOrEqual(
        surface!.y + surface!.height,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});
