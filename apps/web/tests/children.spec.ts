import { expect } from "@playwright/test";
import { hostedTest } from "./isolated-host";
import { openAgent, openTab } from "./agent-journey";

// Each test gets its own data folder.
const fresh = hostedTest;
const start = (args: object) => `tool:pispark_start_session:${JSON.stringify(args)}`;

fresh("a session starts a session: one row for the ask, its answer folded inside; the child is never a row in the session list", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill(start({ brief: "research zustand", title: "Zustand research" }));
  await box.press("Enter");

  // The reply shows one row for the ask: the child's name, which opens it, and how the ask stands.
  const row = page.locator('[data-purpose="ask-row"]');
  await expect(row.getByRole("button", { name: "Open Zustand research" })).toBeVisible();
  await expect(row).toContainText("answered");
  // Where its answer arrived there is one quiet line, not a card: the row holds the answer.
  await expect(page.locator('[data-purpose="delivery"]')).toHaveText(/Answer from Zustand research reached this session/);
  await expect(page.locator('[data-purpose="session-turn"]')).toHaveCount(0);
  // Folded in the row: the child agent's words, drawn as Markdown like any reply, without the line the agent needs.
  const fold = row.getByRole("button", { name: "Show the answer from Zustand research" });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await fold.click();
  await expect(row.locator(".prose")).toHaveText("local:research zustand");
  await expect(row).not.toContainText("you started finished");

  // The session list shows conversations the person started: the child is not a row, and nothing unfolds under its parent.
  const sessions = page.getByRole("navigation", { name: "Sessions" });
  await expect(sessions.getByRole("link")).toHaveCount(1);
  await expect(sessions.getByRole("link", { name: "Zustand research" })).toHaveCount(0);
  await expect(sessions.getByRole("button", { name: /^Sessions (started by|under) / })).toHaveCount(0);

  // It was not kept, so it is put away once it has answered: "Started here" holds nothing, not even under Finished.
  const details = page.getByRole("complementary", { name: "Details" });
  await expect(details.getByRole("list", { name: "Started here" })).toHaveCount(0);
  await expect(details.getByRole("button", { name: /^Finished/ })).toHaveCount(0);
  // Its row still says how the ask ended, and opening it brings the child back.
  await expect(row).toContainText("answered");
  await row.getByRole("button", { name: "Open Zustand research" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Zustand research" })).toBeVisible();
  // Inside the child: who asked and the brief it was given, and that it has answered.
  const brief = page.locator('[data-purpose="session-turn"]');
  await expect(brief).toContainText("Asked by");
  await expect(brief).toContainText("research zustand");
  await expect(page.locator('[data-purpose="sent-up"]')).toHaveText(/^Answered tool:pispark_start_session/);
  // It is still not a row in the list, and once it has answered its parent is no longer told what changes here.
  await expect(sessions.getByRole("link", { name: "Zustand research" })).toHaveCount(0);
  await expect(page.getByText(/is told what you change here/)).toHaveCount(0);

  // Its parent is the way back, in the header.
  await page.getByRole("banner").getByRole("link", { name: /^tool:pispark_start_session/ }).click();
  await expect(page.locator('[data-purpose="ask-row"]')).toContainText("answered");
  // Brought back, it is listed again with what has finished.
  await details.getByRole("button", { name: /^Finished/ }).click();
  await expect(details.getByRole("list", { name: "Finished" })).toContainText("answered");

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
  await openTab(page, "Extensions");
  await page.getByRole("button", { name: /^Built in/ }).click();
  const core = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Built in", level: 2 }) });
  await expect(core.getByRole("switch", { name: "read (read)" })).toBeVisible();
  await expect(core.getByRole("switch", { name: "Start a session (pispark_start_session)" })).toBeChecked();
  await expect(core.getByRole("switch", { name: "Set session title (pispark_set_title)" })).toBeChecked();
  await expect(core.getByText("pispark_schedule", { exact: true })).toBeVisible();
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
  await expect(details.getByRole("list", { name: "Started here" })).toHaveCount(0);
  await expect(details.getByText("Each tells this session when it ends.")).toHaveCount(0);
});
