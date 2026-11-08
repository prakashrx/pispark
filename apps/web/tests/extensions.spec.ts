import { expect } from "@playwright/test";
import { hostedTest as test } from "./isolated-host";

// The test host's Default persona loads an ordinary Pi extension that uses Pi's ctx.ui.
test("an extension's notice, status, widget and question appear around the chat and answer by keyboard", async ({
  page,
}) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(page.getByRole("button", { name: "Start chat" })).not.toHaveAttribute("aria-disabled", "true");
  await ask.fill("ui-show");
  await ask.press("Enter");

  // A warning notice is labelled, not only tinted; status and widget sit by the reply box.
  const notice = page.getByRole("status").filter({ hasText: "Heads up" });
  await expect(notice).toContainText("Warning");
  await expect(page.getByLabel("Extension status")).toHaveText("ready");
  await expect(page.getByText("widget line", { exact: true })).toBeVisible();
  const reply = page.getByRole("textbox", { name: "Reply to chat" });
  await expect(reply).toHaveValue("drafted by fixture");
  await expect(page.getByText("local:ui-show", { exact: true })).toBeVisible();

  // The run waits on the question; it takes focus, arrows move, Enter answers, focus returns.
  await reply.fill("ui-select");
  await reply.press("Enter");
  const question = page.getByRole("group", { name: "Pick one" });
  await expect(question.getByRole("button", { name: "one" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(question.getByRole("button", { name: "two" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(question).toHaveCount(0);
  await expect(reply).toBeFocused();
  await expect(page.getByText("local:ui-select", { exact: true })).toBeVisible();

  // Escape dismisses a question.
  await reply.fill("ui-confirm");
  await reply.press("Enter");
  await expect(page.getByRole("group", { name: "Proceed?" }).getByRole("button", { name: "Yes" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Proceed?" })).toHaveCount(0);
  await expect(page.getByText("local:ui-confirm", { exact: true })).toBeVisible();

  // One header and footer slot, the browser tab title, and Pi's session name as the chat title.
  await reply.fill("ui-chrome");
  await reply.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Named by extension" })).toBeVisible();
  await expect(page.getByText("Fixture header", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Extension status")).toHaveText(/^branch:\S+ statuses:fixture$/);
  await expect(page).toHaveTitle("Fixture window");
});
