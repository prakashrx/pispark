import { expect } from "@playwright/test";
import { hostedTest } from "./isolated-host";

// Each test gets its own data folder.
const fresh = hostedTest;
const SERVER = `node -e "console.log('ready on 5199'); setInterval(() => console.log('tick'), 200)"`;
const start = (args: object) => `tool:pispark_process:${JSON.stringify({ action: "start", ...args })}`;

fresh("a process the agent starts: a row in the reply, live output in the panel, Stop, and Settings → Background", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill(start({ command: SERVER, title: "dev server", report: "status", wait_for: "ready", timeout_seconds: 30 }));
  await box.press("Enter");

  // The reply shows the process with its state; the sidebar row says one is running.
  const row = page.locator('[data-purpose="process-row"]');
  await expect(row).toContainText("dev server");
  await expect(row).toContainText("Running");
  await expect(page.getByRole("navigation", { name: "Chats" }).getByText("1 process running")).toBeAttached();

  // Show output opens the panel on it; output keeps coming while it runs.
  const show = row.getByRole("button", { name: /^Show output/ });
  await show.click();
  const panel = page.getByRole("region", { name: "Processes in this chat" });
  const output = panel.getByLabel("Output of dev server");
  await expect(output).toContainText("ready on 5199");
  await expect(output).toContainText("tick");

  // Stop ends it; in status mode the chat gets a line, not a turn. On Windows, finding the process
  // tree starts PowerShell, which can take seconds on a cold machine.
  await panel.getByRole("button", { name: "Stop dev server" }).click();
  await expect(panel).toContainText("Stopped", { timeout: 20_000 });
  await expect(page.locator('[data-purpose="status-line"]')).toContainText("dev server was stopped", { timeout: 20_000 });

  // Escape closes the panel and gives focus back.
  await panel.focus();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // Settings → Background lists everything that runs without you.
  await page.goto("/#/schedules");
  await expect(page.getByRole("heading", { level: 1, name: "Background" })).toBeVisible();
  for (const section of ["Pause all", "Schedules", "Kept running", "Processes"])
    await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
  await expect(page.getByText("None running.")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
