import { test, expect, type Page } from "@playwright/test";
import { hostedTest } from "./isolated-host";
import { addInstruction, createPersona, openPersona } from "./persona-journey";

// Each test gets its own data folder: Default (read + test extension) and Review (skill + command).
const fresh = hostedTest;

async function personas(page: Page) {
  await page.goto("/#/persona");
  await expect(page.getByRole("heading", { name: "Personas", level: 1 })).toBeVisible();
}
const row = (page: Page, name: string) =>
  page.locator("li").filter({ has: page.getByText(name, { exact: true }) });

fresh("the editor shows each item's source; switches persist across reloads, including by keyboard", async ({ page }) => {
  await personas(page);
  await expect(page.getByRole("button", { name: /^Default/ })).toBeVisible();
  await openPersona(page, "Review");
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
  await openPersona(page, "Review");
  await expect(page.getByRole("switch", { name: "Use skill review" })).not.toBeChecked();
  await expect(row(page, "review")).toContainText("Off");
  // Tools come from Default: read is on, bash is off.
  await expect(page.getByRole("switch", { name: "Allow read" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Allow bash" })).not.toBeChecked();
});

fresh("a new persona builds on another: inherited items say where they come from and can be customized", async ({ page }) => {
  await personas(page);
  await createPersona(page, "Strict review", "Review");
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
  await openPersona(page, "Review");
  await expect(page.getByRole("switch", { name: "Use skill review" })).toBeChecked();
  await expect(row(page, "strict")).toHaveCount(0);
});

fresh("Default is edited from Settings and reaches every persona", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByRole("link", { name: "Edit Default" }).click();
  await expect(page.getByRole("heading", { name: "Default", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete persona" })).toHaveCount(0);
  await addInstruction(page, "Everyone sees this.", "everyone");
  await openPersona(page, "Review");
  await expect(row(page, "everyone")).toContainText("From Default");
});

fresh("a persona change flags the open chat; Reload chat applies it and keeps the messages", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Persona: Default" }).click();
  await page.getByRole("option", { name: "Review", exact: true }).click();
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("first message");
  await ask.press("Enter");
  await expect(page.getByText("first message").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
  const saved = await request.post("/api/personas/file/write", {
    headers: { Origin: new URL(page.url()).origin },
    data: { target: { persona: "review" }, path: "instructions/new.md", expectedRevision: null, text: "New rule" },
  });
  expect(saved.status()).toBe(200);
  const notice = page.getByText("The persona changed. Reload to apply it; your messages stay.");
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "Reload chat" }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByText("first message").first()).toBeVisible();
});

fresh("editing the persona inside a chat changes only that chat", async ({ page }) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("hello there");
  await ask.press("Enter");
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Chat info" }).click();
  await page.getByRole("button", { name: "Edit persona" }).click();
  const panel = page.getByRole("region", { name: "Persona for this chat" });
  await expect(panel).toBeVisible();
  await panel.getByRole("switch", { name: "Allow read" }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByText(/Default \(edited here\)/)).toBeVisible();
  await personas(page);
  await openPersona(page, "Default");
  await expect(page.getByRole("switch", { name: "Allow read" })).toBeChecked();
});

test("the shared Personas page is reachable from Settings and keeps Ask mounted", async ({ page }) => {
  await page.goto("/#/settings");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("kept draft");
  await page.getByRole("link", { name: "Manage personas" }).last().click();
  await expect(page.getByRole("heading", { name: "Personas", level: 1 })).toBeVisible();
  await expect(ask).toHaveValue("kept draft");
});
