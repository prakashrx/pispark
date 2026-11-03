import { test, expect } from "@playwright/test";

const provider = "Local auth fixture";
const id = "pispark-local-test";
test.beforeEach(async ({ request }) => {
  await request.post("/api/providers/logout", { data: { provider: id } });
  await request.post("/api/providers/default", { data: { model: null } });
});
test.afterEach(async ({ request, page }) => {
  if (await page.getByRole("dialog").count()) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
  const { sessions } = await (await request.get("/api/sessions")).json();
  for (const s of sessions.filter(
    (s: { status: string }) => s.status !== "unloaded",
  )) {
    let receipt = await (
      await request.post("/api/commands", {
        data: { type: "stop", sessionId: s.id, commandId: crypto.randomUUID() },
      })
    ).json();
    while (receipt.state === "accepted") {
      await new Promise((r) => setTimeout(r, 30));
      receipt = await (
        await request.get(`/api/receipts/${receipt.commandId}`)
      ).json();
    }
  }
});
async function openLocal(page: import("@playwright/test").Page) {
  await page.goto("/#/providers");
  await expect(
    page.getByRole("heading", { name: "Providers & models", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search providers" })
    .fill("Local auth");
  await expect(
    page.getByRole("button", { name: `Connect ${provider}`, exact: true }),
  ).toBeVisible();
}
async function login(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: `Connect ${provider}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: `Connect ${provider}` });
  await dialog.getByRole("button", { name: /Local test key/ }).click();
  const secret = dialog.getByLabel("Test key", { exact: true });
  await expect(secret).toBeEditable();
  await expect(secret).toHaveAttribute("type", "password");
  await secret.fill("TEST-ONLY-NOT-REAL");
  await secret.press("Enter");
  await expect(dialog.getByRole("status")).toContainText("Sign-in saved");
  await expect(dialog).not.toContainText("TEST-ONLY-NOT-REAL");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
}

test("ProvidersPage: real native key persistence, shared Ask model, durable default and unchanged existing session", async ({
  page,
  request,
  context,
}, info) => {
  const external: string[] = [];
  context.on("request", (r) => {
    if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(r.url());
  });
  await openLocal(page);
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("Keep shared Ask draft");
  await login(page);
  await expect(
    page.getByRole("button", { name: `Manage ${provider}` }),
  ).toBeFocused();
  await expect(page.getByText("Sign-in saved", { exact: true })).toBeVisible();
  for (const width of [390, 1920, 3840]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    await page.screenshot({
      path: info.outputPath(`saved-sign-in-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: `Models for ${provider}` }).click();
  const models = page.getByRole("dialog", { name: `Models for ${provider}` });
  await models
    .getByRole("textbox", { name: "Search models" })
    .fill("deterministic");
  await models.getByRole("radio").check();
  await expect(models.getByRole("radio")).toBeChecked();
  await models.getByRole("button", { name: "Done" }).click();
  await expect(ask).toHaveValue("Keep shared Ask draft");
  await page
    .getByRole("button", {
      name: "Persona: No persona",
    })
    .click();
  await page.locator("[data-selector-popup] summary").click();
  await page
    .getByRole("combobox", { name: "Chat setup", exact: true })
    .selectOption("Catalog resources");
  await page
    .getByRole("button", {
      name: "Persona: No persona",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: /Model: Default:/ }),
  ).toContainText("Deterministic");
  await ask.fill("first catalog session");
  await ask.press("Enter");
  await expect(
    page.getByText("local:first catalog session", { exact: true }),
  ).toBeVisible();
  const a = await page.evaluate(() => localStorage.getItem("pispark-session"));
  await page.goto("/#/providers");
  await page
    .getByRole("textbox", { name: "Search providers" })
    .fill("Local auth");
  await page.getByRole("button", { name: `Models for ${provider}` }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Search models" })
    .fill("second");
  await page.getByRole("radio").check();
  await page.getByRole("button", { name: "Done" }).click();
  expect(
    (await (await request.get(`/api/sessions/${a}/window`)).json()).model.id,
  ).toBe("deterministic");
  await page.reload();
  await expect(
    page.getByText("Second local model · Local auth fixture", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search providers" })
    .fill("Local auth");
  await page
    .getByRole("button", { name: `Disconnect ${provider}`, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await expect(
    page.getByText(/Second local model.*unavailable, saved choice retained/),
  ).toBeVisible();
  expect(
    (await (await request.get(`/api/sessions/${a}/window`)).json()).model.id,
  ).toBe("deterministic");
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([
    "pispark-session",
  ]);
  expect(external).toEqual([]);
});

test("ConnectionDialog: native OAuth variants, safe links, Tab summary regression, Escape/cancel and return focus", async ({
  page,
}) => {
  await openLocal(page);
  const trigger = page.getByRole("button", {
    name: `Connect ${provider}`,
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Local test OAuth/ }).click();
  await expect(
    dialog.getByLabel("Local project", { exact: true }),
  ).toBeFocused();
  await expect(dialog.getByText("LOCAL-CODE", { exact: true })).toBeVisible();
  for (const link of await dialog.getByRole("link").all()) {
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(await link.getAttribute("href")).toMatch(/^https:/);
  }
  // Native text prompts may intentionally accept blank (e.g. Copilot github.com).
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog
    .getByLabel("Local region", { exact: true })
    .selectOption("local");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(
    dialog.getByLabel("Local manual code", { exact: true }),
  ).toBeFocused();
  let reached = false;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    if (
      await dialog
        .locator("summary")
        .evaluate((el) => el === document.activeElement)
    ) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);
  await page.keyboard.press("Enter");
  await expect(dialog.locator("details")).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => document.activeElement?.closest("dialog") !== null,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("button", { name: `Connect ${provider}`, exact: true }),
  ).toBeVisible();
});

for (const width of [1920, 3840, 390])
  test(`ProvidersPage: approved shared shell and actual assets at ${width}px`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    const external: string[] = [];
    context.on("request", (r) => {
      if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
        external.push(r.url());
    });
    await page.goto("/#/providers");
    await expect(
      page.getByRole("button", { name: "Models for Anthropic" }),
    ).toBeVisible();
    await expect(page.getByRole("form", { name: "New chat" })).toHaveCount(1);
    await expect(
      page.getByText(/Design preview|simulator|simulated|Verified ·/),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`providers-${width}.png`),
      fullPage: width === 390,
    });
    await page
      .getByRole("button", { name: "Connect Anthropic", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /API key/ })
      .click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "security-patched Node",
    );
    await page.screenshot({
      path: info.outputPath(`gate-dialog-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Connect Anthropic", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("textbox", { name: "Search providers" })
      .fill("no-such-provider");
    await expect(page.getByText(/No matching providers/)).toBeVisible();
    expect(external).toEqual([]);
  });

test("ProvidersPage: unavailable catalog retry and delayed dialog start cannot leak owner capability after dismissal", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/providers", (route) =>
    fail ? route.abort() : route.continue(),
  );
  await page.goto("/#/providers");
  await expect(page.getByRole("alert")).toContainText(
    "Provider settings unavailable",
  );
  fail = false;
  await page.getByRole("button", { name: "Reload status" }).click();
  await page
    .getByRole("textbox", { name: "Search providers" })
    .fill("Local auth");
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/providers/auth/start", async (route) => {
    const response = await route.fetch();
    await delayed;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: `Connect ${provider}`, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Local test key/ })
    .click();
  const cancelled = page.waitForResponse((response) =>
    response.url().endsWith("/api/providers/auth/cancel"),
  );
  await page.keyboard.press("Escape");
  release();
  expect((await cancelled).status()).toBe(200);
  await page.unroute("**/api/providers/auth/start");
  await login(page); // Native provider lock must have been released by cancellation of the late response.
});

test("AuthPrompt: blank secret/text/manual responses preserve native validation with keyboard on mobile", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocal(page);
  await page
    .getByRole("button", { name: `Connect ${provider}`, exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Local test key/ }).click();
  await expect(dialog.getByLabel("Test key", { exact: true })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("blank-secret-390.png") });
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toContainText("Sign-in saved");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: `Manage ${provider}`, exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Local test OAuth/ }).click();
  await expect(
    dialog.getByLabel("Local project", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeDisabled();
  await dialog
    .getByLabel("Local region", { exact: true })
    .selectOption("local");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(
    dialog.getByLabel("Local manual code", { exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: info.outputPath("blank-manual-390.png") });
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toContainText("Sign-in saved");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: `Manage ${provider}`, exact: true }),
  ).toBeFocused();
});
