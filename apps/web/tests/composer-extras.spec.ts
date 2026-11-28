import { expect } from "@playwright/test";
import { hostedTest } from "./isolated-host";

hostedTest("typing / offers the session's commands; arrows and Enter put one in the reply, Escape closes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Agent: Default" }).click();
  await page.getByRole("option", { name: "Extension views", exact: true }).click();
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("hello");
  await ask.press("Enter");
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");

  const reply = page.getByRole("textbox", { name: "Reply to session" });
  await reply.click();
  await page.keyboard.type("/");
  const list = page.getByRole("listbox", { name: "Prompts and commands" });
  await expect(list).toBeVisible();
  await expect(reply).toHaveAttribute("aria-expanded", "true");
  const options = list.getByRole("option");
  expect(await options.count()).toBeGreaterThan(0);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  // Typing narrows it; Enter picks the one selected and leaves "/name " to send.
  const first = ((await options.first().locator(".slash-name").textContent()) ?? "").slice(1);
  await page.keyboard.type(first.slice(0, 2));
  await page.keyboard.press("Enter");
  await expect(list).toHaveCount(0);
  await expect(reply).toHaveText(new RegExp(`^/${first}\\s?$`));
  // Escape closes the list and leaves the text.
  await reply.fill("/");
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(reply).toHaveText("/");
});

hostedTest("a finished reply and each code block in it can be copied", async ({ page, context }) => {
  await page.goto("/");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  // Typed line by line (Shift+Enter is a new line), so the reply that echoes it has a fenced block.
  await ask.click();
  for (const [index, line] of ["Show me", "```js", "const answer = 42;", "```"].entries()) {
    if (index) await page.keyboard.press("Shift+Enter");
    await page.keyboard.type(line);
  }
  await page.keyboard.press("Enter");
  await expect(page.locator(".prose pre").first()).toBeVisible();

  await page.getByRole("button", { name: "Copy reply" }).click();
  await expect(page.getByText("Reply copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("local:Show me");

  const code = page.locator(".prose pre").last();
  await code.hover();
  await code.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByText("Code copied")).toBeVisible();
  expect((await page.evaluate(() => navigator.clipboard.readText())).trim()).toBe("const answer = 42;");
});

hostedTest("Background explains what runs there, one line each, on demand", async ({ page }) => {
  await page.goto("/#/background");
  await page.getByRole("button", { name: "What runs here" }).click();
  for (const term of ["Processes", "Kept running", "Schedules", "Routines"]) await expect(page.locator(".explain dt", { hasText: term })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".explain")).toHaveCount(0);
});
