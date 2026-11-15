import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderButton } from "./ask";
import { hostedTest } from "./isolated-host";
import { addInstruction, createAgent, openAgent } from "./agent-journey";

// Each test gets its own data folder: Default (read + test extension) and Review (skill + command).
const fresh = hostedTest;

async function agents(page: Page) {
  await page.goto("/#/agent");
  await expect(page.getByRole("heading", { name: "Agents", level: 1 })).toBeVisible();
}
const row = (page: Page, name: string) =>
  page.locator("li").filter({ has: page.getByText(name, { exact: true }) });

fresh("the editor shows each item's source; switches persist across reloads, including by keyboard", async ({ page }) => {
  await agents(page);
  await expect(page.getByRole("button", { name: /^Default/ })).toBeVisible();
  await openAgent(page, "Review");
  await expect(row(page, "review")).toContainText("Added here");
  await expect(row(page, "review")).toContainText("Read the deterministic test checklist");
  await expect(row(page, "checklist")).toContainText("Run the checklist");
  const skill = page.getByRole("switch", { name: "Use skill review" });
  await expect(skill).toBeChecked();
  await skill.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(skill).not.toBeChecked();
  await page.reload();
  await openAgent(page, "Review");
  await expect(page.getByRole("switch", { name: "Use skill review" })).not.toBeChecked();
  await expect(row(page, "review")).toContainText("Off");
  // Tools come from Default: read is on, bash is off.
  await expect(page.getByRole("switch", { name: "Allow read" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Allow bash" })).not.toBeChecked();
});

fresh("a new agent builds on another: inherited items say where they come from and can be customized", async ({ page }) => {
  await agents(page);
  await createAgent(page, "Strict review", "Review");
  await expect(row(page, "review")).toContainText("From Review");
  await page.getByRole("switch", { name: "Use skill review" }).click();
  await expect(row(page, "review")).toContainText("Turned off here");
  await row(page, "checklist").getByRole("button", { name: "View" }).click();
  await expect(page.getByRole("textbox", { name: "checklist text" })).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "Customize here" }).click();
  await expect(row(page, "checklist")).toContainText("Added here");
  await expect(row(page, "checklist")).toContainText("Replaces an inherited one");
  await addInstruction(page, "Be strict.", "strict");
  await expect(row(page, "strict")).toContainText("Added here");
  // The parent is unchanged.
  await openAgent(page, "Review");
  await expect(page.getByRole("switch", { name: "Use skill review" })).toBeChecked();
  await expect(row(page, "strict")).toHaveCount(0);
});

fresh("Default is edited from Settings and reaches every agent", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByRole("link", { name: "Edit Default" }).click();
  await expect(page.getByRole("heading", { name: "Default", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete agent" })).toHaveCount(0);
  await addInstruction(page, "Everyone sees this.", "everyone");
  await openAgent(page, "Review");
  await expect(row(page, "everyone")).toContainText("From Default");
});

fresh("an agent change flags the open session; Reload session applies it and keeps the messages", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Agent: Default" }).click();
  await page.getByRole("option", { name: "Review", exact: true }).click();
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("first message");
  await ask.press("Enter");
  await expect(page.getByText("first message").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
  const saved = await request.post("/api/agents/file/write", {
    headers: { Origin: new URL(page.url()).origin },
    data: { target: { agent: "review" }, path: "instructions/new.md", expectedRevision: null, text: "New rule" },
  });
  expect(saved.status()).toBe(200);
  const notice = page.getByText("The agent changed. Reload to apply it; your messages stay.");
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "Reload session" }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByText("first message").first()).toBeVisible();
});

fresh("editing the agent inside a session changes only that session", async ({ page }) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("hello there");
  await ask.press("Enter");
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Session info" }).click();
  await page.getByRole("button", { name: "Edit for this session" }).click();
  const panel = page.getByRole("region", { name: "Agent for this session" });
  await expect(panel).toBeVisible();
  await panel.getByRole("switch", { name: "Allow read" }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByText(/Default \(edited here\)/)).toBeVisible();
  await agents(page);
  await openAgent(page, "Default");
  await expect(page.getByRole("switch", { name: "Allow read" })).toBeChecked();
});

test("the shared Agents page is reachable from Settings and keeps Ask mounted", async ({ page }) => {
  await page.goto("/#/settings");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("kept draft");
  await page.getByRole("link", { name: "Manage agents" }).last().click();
  await expect(page.getByRole("heading", { name: "Agents", level: 1 })).toBeVisible();
  await expect(ask).toHaveValue("kept draft");
});

fresh("a project agent: the editor sets its working folder, Ask shows it locked, and the session starts there", async ({ page }) => {
  const project = await realpath(await mkdtemp(join(tmpdir(), "pispark-project-")));
  try {
    await agents(page);
    await openAgent(page, "Review");
    // Ask is on this page too, so the editor's own choice is found through its section.
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Working folder", exact: true }) });
    const choice = section.getByRole("button", { name: /^Working folder:/ });
    const none = "Working folder: None: Ask chooses the folder";
    await expect(choice).toHaveAccessibleName(none);
    // By keyboard, a folder that is not there: refused in words, and nothing changes.
    await choice.focus();
    await page.keyboard.press("Enter");
    await section.getByRole("textbox", { name: "Another folder" }).fill(join(project, "missing"));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "That folder doesn’t exist on the server." })).toBeVisible();
    await expect(choice).toHaveAccessibleName(none);
    await choice.click();
    await section.getByRole("textbox", { name: "Another folder" }).fill(project);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await expect(choice).toHaveAccessibleName(`Working folder: ${project}`);
    await expect(choice).toBeFocused();
    // An agent that builds on it works there too, and says where the folder comes from.
    await page.getByRole("button", { name: "All agents" }).click();
    await createAgent(page, "Project reviewer", "Review");
    await expect(section).toContainText(`Inherited: ${project}`);
    await expect(choice).toHaveAccessibleName("Working folder: Inherited folder");

    await page.goto("/");
    await page.getByRole("button", { name: "Agent: Default" }).click();
    await page.getByRole("option", { name: "Review", exact: true }).click();
    const locked = page.getByRole("button", { name: `Working folder: ${project}. Set by the agent`, exact: true });
    await expect(locked).toHaveAttribute("aria-disabled", "true");
    // The keyboard reaches it, and it opens nothing.
    await locked.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
    await ask.fill("in the project");
    await ask.press("Enter");
    await expect(page.getByText("in the project").first()).toBeVisible();
    await page.getByRole("button", { name: "Session info" }).click();
    await expect(page.getByText(project, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    // With another agent, the folder is Ask's to choose again.
    await page.getByRole("button", { name: "Agent: Review" }).click();
    await page.getByRole("option", { name: "Default", exact: true }).click();
    await expect(folderButton(page)).not.toHaveAttribute("aria-disabled", "true");
    await expect(folderButton(page)).not.toHaveAccessibleName(new RegExp("Set by the agent"));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
