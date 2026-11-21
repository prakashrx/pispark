import { expect } from "@playwright/test";
import { hostedTest } from "./isolated-host";
import { openAgent } from "./agent-journey";

// Each test gets its own data folder.
const fresh = hostedTest;
const start = (args: object) => `tool:pispark_session:${JSON.stringify({ action: "start", ...args })}`;

fresh("a session starts a session; its answer comes back as a card; the child sits under its parent", async ({ page }) => {
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
  // The report is the child agent's words, drawn as Markdown like any reply.
  await expect(report.locator(".prose")).toHaveCount(1);
  await expect(report).not.toContainText("you started finished");

  // In the sidebar the child is under its parent, behind a toggle once it is done.
  const sessions = page.getByRole("navigation", { name: "Sessions" });
  const toggle = sessions.getByRole("button", { name: /^Sessions started by / });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(sessions.getByRole("group", { name: /^Started by / }).getByRole("link", { name: "Zustand research" })).toBeVisible();

  // Details list it; opening it shows where it came from.
  const started = page.getByRole("list", { name: "Sessions it started" });
  await expect(started).toContainText("Finished");
  await started.getByRole("button", { name: "Zustand research" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Zustand research" })).toBeVisible();
  // Details say where it came from, with a way back.
  await expect(page.getByRole("complementary", { name: "Details" }).getByText("Started by", { exact: true })).toBeVisible();
  await expect(page.locator('[data-purpose="session-turn"]')).toContainText("research zustand");
  await expect(sessions.getByRole("group", { name: /^Started by / }).getByRole("link", { name: "Zustand research" })).toHaveAttribute("aria-current", "page");

  // Back to the parent from the header link.
  await page.getByRole("button", { name: /^tool:pispark_session/ }).first().click();
  await expect(page.locator('[data-purpose="session-turn"]')).toContainText("finished");

  await page.setViewportSize({ width: 390, height: 844 });
  const wide = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && e.getBoundingClientRect().width > 0)
      .map((e) => `${e.tagName}.${String(e.className).slice(0, 60)}`)
      .slice(0, 5),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), wide.join(" | ")).toBe(true);
});

fresh("the agent editor lists PiSpark's own tools, found in its built-in extension", async ({ page }) => {
  await page.goto("/#/agents");
  await openAgent(page, "Default");
  const core = page.getByRole("list", { name: "PiSpark tools" });
  await expect(core.getByRole("switch", { name: "Allow read" })).toBeVisible();
  await expect(core.getByRole("switch", { name: "Allow Session tools" })).toBeChecked();
  await expect(core.getByRole("switch", { name: "Allow Set session title" })).toBeChecked();
  await expect(core.getByText("pispark_schedule")).toBeVisible();
});

fresh("manual forks appear beneath their source and are listed separately from sessions started by the agent", async ({ page }) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("Original context");
  await ask.press("Enter");
  await expect(page.getByText("local:Original context", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Session actions" }).click();
  await page.getByRole("menuitem", { name: "Fork session" }).click();
  const details = page.getByRole("complementary", { name: "Details" });
  await expect(details.getByText("Forked from", { exact: true })).toBeVisible();
  await expect(page.getByText("local:Original context", { exact: true })).toBeVisible();
  await details.getByRole("button", { name: "Original context", exact: true }).click();
  await expect(details.getByRole("list", { name: "Forks", exact: true })).toContainText("Fork of Original context");
  await expect(details.getByRole("list", { name: "Sessions it started" })).toHaveCount(0);
  await expect(details.getByText("Each tells this session when it ends.")).toHaveCount(0);
});
