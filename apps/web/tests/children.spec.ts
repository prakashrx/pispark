import { expect } from "@playwright/test";
import { hostedTest } from "./isolated-host";
import { openPersona } from "./persona-journey";

// Each test gets its own data folder.
const fresh = hostedTest;
const start = (args: object) => `tool:pispark_session:${JSON.stringify({ action: "start", ...args })}`;

fresh("a chat starts a session; its answer comes back as a card; the child sits under its parent", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill(start({ prompt: "research zustand", title: "Zustand research" }));
  await box.press("Enter");

  // The reply shows the session it started, with its state and a way to open it.
  await expect(page.getByRole("button", { name: "Open Zustand research" })).toBeVisible();
  // Its answer comes back as a turn from it, not as your bubble.
  const report = page.locator('[data-purpose="session-turn"]');
  await expect(report).toHaveCount(1);
  await expect(report).toContainText("From Zustand research · finished");
  // The card shows the answer, not the line the agent needs ("The session … you started finished:").
  await expect(report).toContainText("local:research zustand");
  await expect(report).not.toContainText("you started finished");

  // In the sidebar the child is under its parent, behind a toggle once it is done.
  const chats = page.getByRole("navigation", { name: "Chats" });
  const toggle = chats.getByRole("button", { name: /^Sessions started by / });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(chats.getByRole("group", { name: /^Started by / }).getByRole("link", { name: "Zustand research" })).toBeVisible();

  // Chat info lists it; opening it shows where it came from.
  await page.getByRole("button", { name: "Chat info" }).click();
  const started = page.getByRole("list", { name: "Sessions it started" });
  await expect(started).toContainText("Finished");
  await started.getByRole("button", { name: "Zustand research" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Zustand research" })).toBeVisible();
  await expect(page.getByText(/^Started by /)).toBeVisible();
  await expect(page.locator('[data-purpose="session-turn"]')).toContainText("research zustand");
  await expect(chats.getByRole("group", { name: /^Started by / }).getByRole("link", { name: "Zustand research" })).toHaveAttribute("aria-current", "page");

  // Back to the parent from the header link.
  await page.getByRole("button", { name: /^tool:pispark_session/ }).first().click();
  await expect(page.locator('[data-purpose="session-turn"]')).toContainText("finished");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

fresh("the persona editor lists PiSpark's own tools, found in its built-in extension", async ({ page }) => {
  await page.goto("/#/persona");
  await openPersona(page, "Default");
  const core = page.getByRole("list", { name: "PiSpark tools" });
  await expect(core.getByRole("switch", { name: "Allow read" })).toBeVisible();
  await expect(core.getByRole("switch", { name: "Allow Start other sessions" })).toBeChecked();
  await expect(core.getByRole("switch", { name: "Allow Set chat title" })).toBeChecked();
  await expect(core.getByText("pispark_schedule")).toBeVisible();
});
