import { expect } from "@playwright/test";
import { hostedTest as test } from "./isolated-host";

// The test host's Default agent loads an ordinary Pi extension that uses Pi's ctx.ui.
test("an extension's notice and question appear around the session and answer by keyboard; terminal-style text does not", async ({
  page,
}) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(page.getByRole("button", { name: "Start session" })).not.toHaveAttribute("aria-disabled", "true");
  await ask.fill("ui-show");
  await ask.press("Enter");

  // A warning notice is labelled, not only tinted. Pi's terminal-style status and widget text is
  // not shown in PiSpark (an extension contributes a component for that).
  const notice = page.getByRole("status").filter({ hasText: "Heads up" });
  await expect(notice).toContainText("Warning");
  await expect(page.getByText("local:ui-show", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Extension status")).toHaveCount(0);
  await expect(page.getByText("widget line", { exact: true })).toHaveCount(0);
  const reply = page.getByRole("textbox", { name: "Reply to session" });
  await expect(reply).toHaveText("drafted by fixture");
  await expect(page.getByText("local:ui-show", { exact: true })).toBeVisible();

  // The run waits on the question; it takes focus, arrows move, Enter answers, focus returns.
  await reply.fill("ui-select");
  await reply.press("Enter");
  const question = page.getByRole("group", { name: "Pick one" });
  // Its tone is in words as well as colour: an ordinary question just needs you.
  await expect(question).toContainText("Needs you");
  await expect(question.getByRole("button", { name: "one" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(question.getByRole("button", { name: "two" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(question).toHaveCount(0);
  await expect(reply).toBeFocused();
  await expect(page.getByText("local:ui-select", { exact: true })).toBeVisible();
  // The session keeps a line of what was asked and chosen.
  await expect(page.getByText("Pick one — you chose two", { exact: true })).toBeVisible();

  // A confirmation starts on the question itself, not on an answer; Y and N answer, Escape skips.
  await reply.fill("ui-confirm");
  await reply.press("Enter");
  const confirm = page.getByRole("group", { name: "Proceed?" });
  await expect(confirm).toBeFocused();
  await expect(confirm.getByRole("button", { name: "Yes" })).not.toBeFocused();
  await expect(confirm.getByRole("button", { name: "No" })).toBeVisible();
  await page.keyboard.press("n");
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText("Proceed? — you said no", { exact: true })).toBeVisible();
  await expect(page.getByText("local:ui-confirm", { exact: true })).toBeVisible();
  await reply.fill("ui-confirm");
  await reply.press("Enter");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText("Proceed? — skipped", { exact: true })).toBeVisible();
  await expect(page.getByText("local:ui-confirm", { exact: true })).toHaveCount(2);

  // The browser tab title and Pi's session name as the session title; the header and footer text
  // are terminal-style, so not shown.
  await reply.fill("ui-chrome");
  await reply.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Named by extension" })).toBeVisible();
  await expect(page).toHaveTitle("Fixture window");
  await expect(page.getByText("Fixture header", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Extension status")).toHaveCount(0);
});
