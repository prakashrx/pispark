import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const routes = ["workspace", "settings", "persona", "sources"] as const;

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
    const measurements = [];
    for (const route of routes) {
      if (route !== "workspace") await navigate(page, route);
      await page.evaluate(() => document.fonts.ready);
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
        const composer = document.querySelector(
          '[aria-label="New session draft"]',
        )!;
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
        x: 288,
        y: 0,
        width: width - 288,
        height: 56,
      });
      expect(metrics.sidebar).toMatchObject({
        x: 0,
        y: 0,
        width: 288,
        height: 1200,
      });
      expect(metrics.brand.height).toBe(56);
      expect(metrics.composer.x).toBe(312);
      expect(metrics.composer.width).toBe(width - 288 - 48);
      expect(width - metrics.composer.x - metrics.composer.width).toBe(24);
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
  const ask = page.getByRole("textbox", { name: "Ask anything (local draft)" });
  const mountedAsk = await ask.elementHandle();
  await ask.fill("Persistent global question");
  await page
    .getByRole("textbox", { name: /Reply to Workspace/ })
    .fill("Independent session follow-up");
  await page.getByRole("button", { name: "Folder: pispark" }).click();
  await page.getByRole("combobox", { name: "Search Folder" }).fill("notes");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Persona: Developer" }).click();
  await page.getByRole("option", { name: "Architect", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Style:/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Persona: Architect" }).click();
  await page.getByRole("option", { name: "Developer", exact: true }).click();
  // The honest fixtures currently supply one Style and one Model option.
  for (const label of ["Style: Concise", "Model: balanced"]) {
    await page.getByRole("button", { name: label }).click();
    await page
      .getByRole("option", { name: label.split(": ")[1], exact: true })
      .click();
  }
  async function retained() {
    await expect(ask).toHaveValue("Persistent global question");
    expect(
      await mountedAsk!.evaluate(
        (el) =>
          el ===
          document.querySelector('[aria-label="Ask anything (local draft)"]'),
      ),
    ).toBe(true);
    for (const label of [
      "Folder: notes",
      "Persona: Developer",
      "Style: Concise",
      "Model: balanced",
    ]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
    await expect(
      page.getByRole("form", { name: "New session draft" }),
    ).toHaveCount(1);
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
  const reply = page.getByRole("textbox", { name: /Reply to Workspace/ });
  await expect(reply).toHaveValue("Independent session follow-up");
  await reply.fill("Changed reply only");
  await retained();
  // Also prove a non-default persona survives a navigation, not merely the default.
  await page.getByRole("button", { name: "Persona: Developer" }).click();
  await page.getByRole("option", { name: "General", exact: true }).click();
  await navigate(page, "settings");
  await expect(
    page.getByRole("button", { name: "Persona: General" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Style:/ })).toHaveCount(0);
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
    await page.getByRole("button", { name: "Folder: pispark" }).click();
    await expect(
      page.getByRole("combobox", { name: "Search Folder" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Folder: pispark" }),
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
        .getByRole("form", { name: "New session draft" })
        .boundingBox();
      const run = await page
        .getByRole("button", { name: "Run", exact: true })
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
