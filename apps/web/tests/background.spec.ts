import { expect } from "@playwright/test";
import { hostedTest } from "./isolated-host";
import { newSession } from "./ask";

// Each test gets its own data folder.
const fresh = hostedTest;
const SERVER = `node -e "console.log('ready on 5199'); setInterval(() => console.log('tick'), 200)"`;
const start = (args: object) => `tool:pispark_start_process:${JSON.stringify(args)}`;

fresh("a process the agent starts: a row in the reply, on Background naming its session, live output in the panel, Stop", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill(start({ command: SERVER, title: "dev server" }));
  await box.press("Enter");

  // The reply shows the process with its state; the session's row in the sidebar counts what is still going.
  const row = page.locator('[data-purpose="process-row"]');
  await expect(row).toContainText("dev server");
  await expect(row).toContainText("Running");
  await expect(page.getByRole("navigation", { name: "Sessions" }).getByText("Still going: 1 process")).toBeAttached();

  // Background lists it among what is running, naming its session; its row opens the session on its output.
  const session = page.url();
  await page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: /^Background/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Background" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Running 1" })).toBeVisible();
  await page.getByRole("button", { name: "Running 1" }).click();
  await expect(page.getByRole("button", { name: "Running 1" })).toHaveAttribute("aria-pressed", "true");
  const running = page.getByRole("region", { name: "Running" });
  await expect(running.getByRole("listitem")).toHaveCount(1);
  await expect(running.getByRole("listitem")).toContainText(/tool:pispark_start_process.* · Running/);
  await running.getByRole("button", { name: /^dev server/ }).click();
  await expect(page).toHaveURL(session);
  const panel = page.getByRole("complementary", { name: "Process output" });
  await expect(panel.getByLabel("Output of dev server")).toBeVisible();

  // Show output in the reply opens the panel on it too; output keeps coming while it runs.
  await panel.getByRole("button", { name: "Back to Details" }).click();
  await row.getByRole("button", { name: /^Show output/ }).click();
  const output = panel.getByLabel("Output of dev server");
  await expect(output).toContainText("ready on 5199");
  await expect(output).toContainText("tick");

  // Stop ends it; the session gets a line saying you stopped it, not a turn. On Windows, finding the process
  // tree starts PowerShell, which can take seconds on a cold machine.
  await panel.getByRole("button", { name: "Stop dev server" }).click();
  await expect(panel).toContainText("Stopped", { timeout: 20_000 });
  await expect(page.locator('[data-purpose="status-line"]')).toContainText("dev server was stopped", { timeout: 20_000 });

  // Escape goes back to Details, which take focus.
  await panel.getByRole("heading", { name: "Process output" }).focus();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "Details" })).toBeFocused();

  // With it stopped, nothing runs in the background.
  await page.goto("/#/background");
  await expect(page.getByRole("button", { name: "Running 0" })).toBeVisible();
  await expect(page.getByText(/^Nothing runs in the background/)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

fresh("a session is not a row on Background: a working reply shows in the session list", async ({ page }) => {
  await page.goto("/");
  await newSession(page);
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill("hold the line");
  await box.press("Enter");
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.goto("/#/background");
  await expect(page.getByText(/^Nothing runs in the background/)).toBeVisible();
  await expect(page.getByRole("main").getByText("hold the line")).toHaveCount(0);
  // The session list says it is working, and opens it.
  const sessions = page.getByRole("navigation", { name: "Sessions" });
  await expect(sessions.getByText("Working")).toBeAttached();
  await sessions.getByRole("link", { name: "hold the line" }).click();
  await page.getByRole("button", { name: "Stop" }).click();
});

fresh("a completed process discloses its original output on demand", async ({ page }) => {
  await page.goto("/#/new");
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill(start({ command: 'node -e "console.log(78143)"', title: "Catalog sample" }));
  await box.press("Enter");
  const report = page.locator("details").filter({ has: page.locator("summary", { hasText: "Catalog sample · exited 0" }) });
  const summary = report.locator("summary");
  await expect(summary).toContainText("Show output", { timeout: 20_000 });
  const output = report.locator(".output");
  await expect(output).toBeHidden();
  await summary.click();
  await expect(output).toBeVisible();
  await expect(output).toContainText("78143");
  await summary.press("Enter");
  await expect(output).toBeHidden();
});

fresh("process ends that waited for a working session arrive as one turn, each with its own output", async ({ page }) => {
  await page.goto("/#/new");
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  const quick = (title: string) => ({ name: "pispark_start_process", args: { command: `node -e "console.log('${title} ok')"`, title } });
  const slow = { name: "pispark_start_process", args: { command: 'node -e "setTimeout(() => {}, 2500)"', title: "slow" } };
  // The session waits for the slow one in its turn, while the two quick ones end.
  await box.fill(`steps:${JSON.stringify([quick("lint"), quick("types"), slow, { name: "pispark_wait", args: { ids: ["process-3"] } }])}`);
  await box.press("Enter");
  const together = page.locator('[data-purpose="together"]');
  await expect(together).toHaveCount(1, { timeout: 30_000 });
  const reports = together.locator("details");
  await expect(reports).toHaveCount(2);
  await expect(reports.nth(0).locator("summary")).toContainText("lint · exited 0");
  await expect(reports.nth(1).locator("summary")).toContainText("types · exited 0");
  // Each opens on its own output, not on the whole message.
  await reports.nth(1).locator("summary").click();
  await expect(reports.nth(1).locator(".output")).toHaveText(/^types ok\s*$/);
  await expect(reports.nth(0).locator(".output")).toBeHidden();
});
