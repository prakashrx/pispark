import { newSession, shownSession } from "./ask";
import { hostedTest } from "./isolated-host";
import { test, expect } from "@playwright/test";

const provider = "Local auth fixture";
const id = "pispark-local-test";
test.beforeEach(async ({ request }) => {
  await request.post("/api/providers/logout", { data: { provider: id } });
  await request.post("/api/providers/default", { data: { model: null } });
});
test.afterEach(async ({ request, page }) => {
  if (await page.getByRole("dialog").count()) await page.keyboard.press("Escape");
  const { sessions } = await (await request.get("/api/sessions")).json();
  for (const s of sessions.filter((s: { status: string }) => s.status !== "unloaded")) {
    let receipt = await (
      await request.post("/api/commands", {
        data: { type: "stop", sessionId: s.id, commandId: crypto.randomUUID() },
      })
    ).json();
    while (receipt.state === "accepted") {
      await new Promise((r) => setTimeout(r, 30));
      receipt = await (await request.get(`/api/receipts/${receipt.commandId}`)).json();
    }
  }
});
type Page = import("@playwright/test").Page;
/** Your providers: the ones set up, each opening its own dialog. */
const yours = (page: Page) => page.getByRole("region", { name: "Your providers" });
/** A provider's row in Your providers. */
const summary = (page: Page, name = provider) => yours(page).getByRole("button", { name: new RegExp(`^${name}`) });
/** The Add a provider button. */
const add = (page: Page) => yours(page).getByRole("button", { name: "Add a provider" });
/** Opens a provider: its own dialog once set up, otherwise chosen in Add a provider. */
async function expand(page: Page, name = provider) {
  if (await summary(page, name).count()) {
    await summary(page, name).click();
    await expect(page.getByRole("dialog", { name })).toBeVisible();
    return;
  }
  await add(page).click();
  const dialog = page.getByRole("dialog", { name: "Add a provider" });
  await dialog.getByRole("textbox", { name: "Search providers" }).fill(name);
  await dialog.getByRole("button", { name: new RegExp(`^${name}`) }).click();
}
const signIn = (page: Page, name = provider) => page.getByRole("region", { name: `Sign in to ${name}`, exact: true });
const modelsOf = (page: Page, name = provider) => page.getByRole("region", { name: `Models for ${name}`, exact: true });
async function openLocal(page: import("@playwright/test").Page, by: "address" | "sidebar" = "address") {
  if (by === "address") await page.goto("/#/settings/providers");
  else {
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Providers & models" }).click();
  }
  await expect(yours(page)).toBeVisible();
}
async function login(page: import("@playwright/test").Page) {
  await expand(page);
  const dialog = signIn(page);
  await dialog.getByRole("button", { name: /Local test key/ }).click();
  const secret = dialog.getByLabel("Test key", { exact: true });
  await expect(secret).toBeEditable();
  await expect(secret).toHaveAttribute("type", "password");
  await secret.fill("TEST-ONLY-NOT-REAL");
  await secret.press("Enter");
  await expect(dialog.getByRole("status")).toContainText("Sign-in saved");
  await expect(dialog).not.toContainText("TEST-ONLY-NOT-REAL");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(summary(page)).toBeVisible();
}

hostedTest("the default model picker accepts physical pointer clicks at narrow and wide widths", async ({ page, request }) => {
  await openLocal(page);
  await login(page);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const trigger = page.getByRole("button", { name: /^Default model:/ });
    await trigger.click();
    const option = page.getByRole("option", { name: width === 390 ? /deterministic/i : /second/i }).first();
    await expect(option).toBeVisible();
    // On a phone the picker is a sheet that slides up: measure where it comes to rest.
    await option.evaluate((element) =>
      Promise.all(
        element
          .closest("[data-selector-popup]")!
          .getAnimations()
          .map((animation) => animation.finished),
      ),
    );
    const point = await option.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2,
        y = box.top + box.height / 2;
      return { x, y, hit: element.contains(document.elementFromPoint(x, y)) };
    });
    expect(point.hit).toBe(true);
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/providers/default") && r.request().method() === "POST");
    await page.mouse.click(point.x, point.y);
    expect((await saved).ok()).toBe(true);
    await expect
      .poll(async () => (await (await request.get("/api/providers")).json()).defaultModel?.id)
      .toBe(width === 390 ? "deterministic" : "second");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }
});

test("ProvidersPage: real native key persistence, shared Ask model, durable default and unchanged existing session", async ({
  page,
  request,
  context,
}, info) => {
  const external: string[] = [];
  context.on("request", (r) => {
    if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) external.push(r.url());
  });
  // A new session's draft waits while its model is set up in Settings.
  await page.goto("/#/new");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("Keep shared Ask draft");
  await openLocal(page, "sidebar");
  await login(page);
  await expect(add(page)).toBeFocused();
  await expect(summary(page)).toContainText("models");
  for (const width of [390, 1920, 3840]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    await page.screenshot({
      path: info.outputPath(`saved-sign-in-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expand(page);
  const models = modelsOf(page);
  // Search appears only for long model lists; the fixture has two models.
  const deterministic = models.getByRole("radio", { name: /deterministic/i });
  await deterministic.check();
  await expect(deterministic).toBeChecked();
  // Checking the native radio precedes persistence. Wait for the dialog to finish saving.
  await expect(models.getByText("Default", { exact: true })).toBeVisible();
  await expect(deterministic).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await newSession(page);
  await expect(ask).toHaveText("Keep shared Ask draft");
  await expect(page.getByRole("button", { name: /Model: Default:/ })).toContainText("Deterministic");
  await ask.fill("first catalog session");
  await ask.press("Enter");
  await expect(page.getByText("local:first catalog session", { exact: true })).toBeVisible();
  const a = await shownSession(page);
  await page.goto("/#/settings/providers");
  await expand(page);
  await modelsOf(page)
    .getByRole("radio", { name: /second/i })
    .check();
  await expect(page.getByRole("status").filter({ hasText: "Default saved" })).toBeVisible();
  expect((await (await request.get(`/api/sessions/${a}`)).json()).model.id).toBe("deterministic");
  await page.reload();
  await expect(page.getByText("Second local model · Local auth fixture", { exact: true })).toBeVisible();
  await expand(page);
  await page.getByRole("button", { name: `Disconnect ${provider}`, exact: true }).click();
  await page
    .getByRole("button", {
      name: `Confirm disconnect ${provider}`,
      exact: true,
    })
    .click();
  await expect(page.getByText(/Second local model is unavailable; the saved choice is kept/)).toBeVisible();
  expect((await (await request.get(`/api/sessions/${a}`)).json()).model.id).toBe("deterministic");
  // Browser storage holds nothing of the session: the address says which one is open.
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(external).toEqual([]);
});

test("ProviderConnection: native OAuth variants, safe links, Tab summary regression, Escape/cancel and return focus", async ({ page }) => {
  await openLocal(page);
  const trigger = add(page);
  await expand(page);
  const dialog = signIn(page);
  await dialog.getByRole("button", { name: /Local test OAuth/ }).click();
  await expect(dialog.getByLabel("Local project", { exact: true })).toBeFocused();
  await expect(dialog.getByText("LOCAL-CODE", { exact: true })).toBeVisible();
  for (const link of await dialog.getByRole("link").all()) {
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(await link.getAttribute("href")).toMatch(/^https:/);
  }
  // Native text prompts may intentionally accept blank (e.g. Copilot github.com).
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByLabel("Local region", { exact: true }).selectOption("local");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByLabel("Local manual code", { exact: true })).toBeFocused();
  let reached = false;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    if (await dialog.locator("summary").evaluate((el) => el === document.activeElement)) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);
  await page.keyboard.press("Enter");
  await expect(dialog.locator("details")).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest(".provider-panel") !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(summary(page)).toHaveCount(0);
});

for (const width of [1920, 3840, 390])
  test(`ProvidersPage: approved shared shell and actual assets at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    const external: string[] = [];
    context.on("request", (r) => {
      if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) external.push(r.url());
    });
    await page.goto("/#/settings/providers");
    await expect(yours(page)).toBeVisible();
    // One message box, and only where a session starts or is replied to: none in Settings.
    await expect(page.getByRole("form", { name: "New session" })).toHaveCount(0);
    await expect(page.getByText(/Design preview|simulator|simulated|Verified ·/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: info.outputPath(`providers-${width}.png`),
      fullPage: width === 390,
    });
    await expand(page, "Anthropic");
    await expect(signIn(page, "Anthropic")).toBeVisible();
    await signIn(page, "Anthropic")
      .getByRole("button", { name: /API key/ })
      .click();
    await expect(signIn(page, "Anthropic").getByRole("alert")).toContainText("security-patched Node");
    await page.screenshot({
      path: info.outputPath(`gate-dialog-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(add(page)).toBeFocused();
    await add(page).click();
    await page.getByRole("textbox", { name: "Search providers" }).fill("no-such-provider");
    await expect(page.getByText(/No matching providers/)).toBeVisible();
    await page.keyboard.press("Escape");
    expect(external).toEqual([]);
  });

test("ProvidersPage: unavailable catalog retry and delayed dialog start cannot leak owner capability after dismissal", async ({ page }) => {
  let fail = true;
  // The catalog read and the page's own read with `?check`: both fail until retried.
  await page.route(/\/api\/providers(\?check)?$/, (route) => (fail ? route.abort() : route.continue()));
  await page.goto("/#/settings/providers");
  await expect(page.getByRole("alert")).toContainText("Provider settings unavailable");
  fail = false;
  await page.getByRole("button", { name: "Reload status" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/providers/auth/start", async (route) => {
    const response = await route.fetch();
    await delayed;
    await route.fulfill({ response });
  });
  await expand(page);
  await signIn(page)
    .getByRole("button", { name: /Local test key/ })
    .click();
  const cancelled = page.waitForResponse((response) => response.url().endsWith("/api/providers/auth/cancel"));
  await page.keyboard.press("Escape");
  release();
  expect((await cancelled).status()).toBe(200);
  await page.unroute("**/api/providers/auth/start");
  await login(page); // Native provider lock must have been released by cancellation of the late response.
});

test("AuthPrompt: blank secret/text/manual responses preserve native validation with keyboard on mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocal(page);
  await expand(page);
  let dialog = signIn(page);
  await dialog.getByRole("button", { name: /Local test key/ }).click();
  await expect(dialog.getByLabel("Test key", { exact: true })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("blank-secret-390.png") });
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toContainText("Sign-in saved");
  await page.keyboard.press("Escape");
  await expand(page);
  dialog = signIn(page);
  await dialog.getByRole("button", { name: /Local test OAuth/ }).click();
  await expect(dialog.getByLabel("Local project", { exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeDisabled();
  await dialog.getByLabel("Local region", { exact: true }).selectOption("local");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByLabel("Local manual code", { exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath("blank-manual-390.png") });
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toContainText("Sign-in saved");
  await page.keyboard.press("Escape");
  await expect(summary(page)).toBeFocused();
});

test("shared model radios preserve native keyboard grouping, disabled options, default save errors and focus return", async ({
  page,
  request,
}) => {
  await openLocal(page);
  await login(page);
  // Add only an unavailable display fixture between two actual local provider models, in either read.
  await page.route(/\/api\/providers(\?check)?$/, async (route) => {
    const response = await route.fetch(),
      catalog = await response.json();
    const local = catalog.providers.find((p: { id: string }) => p.id === id);
    local.models.splice(1, 0, {
      ...local.models[0],
      id: "unavailable-display-fixture",
      name: "Unavailable display fixture",
      available: false,
    });
    await route.fulfill({ response, json: catalog });
  });
  await page.reload();
  const trigger = summary(page);
  // Settings loads when first shown: wait for the provider before choosing how to open it.
  await expect(trigger).toBeVisible();
  await expand(page);
  const dialog = modelsOf(page);
  const radios = dialog.getByRole("radio");
  await expect(radios).toHaveCount(3);
  await expect(radios.nth(1)).toBeDisabled();
  let writes = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/providers/default") && req.method() === "POST") writes++;
  });
  await radios.nth(0).focus();
  expect(writes).toBe(0);
  await page.keyboard.press("Space");
  await expect(radios.nth(0)).toBeChecked();
  await expect.poll(() => writes).toBe(1);
  await expect(radios.nth(2)).toBeEnabled();
  await radios.nth(0).focus();
  await page.keyboard.press("ArrowDown");
  await expect(radios.nth(2)).toBeChecked();
  await expect.poll(() => writes).toBe(2);
  await expect(radios.nth(1)).not.toBeChecked();
  await expect(radios.nth(0)).toBeEnabled();
  await page.route("**/api/providers/default", (route) => route.fulfill({ status: 500, json: { error: "storage" } }));
  await radios.nth(0).check();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect((await (await request.get("/api/providers")).json()).defaultModel.id).toBe("second");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

// Its own server: the shared one keeps its sign-in for the files that follow.
hostedTest(
  "opening Providers checks saved sign-ins: one that no longer works says so, and its dialog asks to sign in again",
  async ({ page }) => {
    // The server's check is covered by its own test; here its answer is that the saved sign-in failed.
    // The provider has a saved sign-in; the check (only when asked) finds it no longer works.
    await page.route(
      (url) => url.pathname === "/api/providers",
      async (route) => {
        const response = await route.fetch();
        const catalog = await response.json();
        const checked = new URL(route.request().url()).search === "?check";
        for (const each of catalog.providers)
          if (each.id === id) Object.assign(each, { configured: true, stored: true, ...(checked ? { health: "expired" } : {}) });
        await route.fulfill({ response, json: catalog });
      },
    );
    await page.goto("/#/settings/providers");
    const row = summary(page);
    await expect(row).toContainText("! Sign-in expired");
    await row.click();
    await expect(
      page.getByRole("dialog", { name: provider }).getByRole("status").filter({ hasText: "The saved sign-in no longer works." }),
    ).toBeVisible();
  },
);
