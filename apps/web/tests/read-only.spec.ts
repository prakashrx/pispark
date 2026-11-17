import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { hostedTest } from "./isolated-host";
import { newSession, shownSession } from "./ask";

const provider = "pispark-local-test";

async function command(request: APIRequestContext, data: Record<string, unknown>) {
  let receipt = await (await request.post("/api/commands", { data: { ...data, commandId: crypto.randomUUID() } })).json();
  while (receipt.state === "accepted") {
    await new Promise((resolve) => setTimeout(resolve, 30));
    receipt = await (await request.get(`/api/receipts/${receipt.commandId}`)).json();
  }
  return receipt;
}
async function ask(page: Page, text: string) {
  await newSession(page);
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill(text);
  await box.press("Enter");
  await expect(page.getByText(`local:${text}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
  return (await shownSession(page))!;
}
const cantReply = (page: Page) => page.getByRole("group", { name: "Can’t reply" });

hostedTest("a session whose model is gone is read with its history; Choose a model lets it go on", async ({ page, request }) => {
  await page.goto("/");
  const id = await ask(page, "keep this history");
  // The model goes away (as when a provider drops it): the session opens to be read.
  await command(request, { type: "reload", sessionId: id, model: { provider, id: "retired-model" } });
  await expect(cantReply(page)).toContainText("Can’t reply: retired-model is no longer available.");
  await expect(page.getByText("local:keep this history", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Reply to session" })).toHaveCount(0);

  // Choose a model that works: the session opens fully, history kept, and replies.
  await cantReply(page).getByRole("button", { name: "Choose a model" }).click();
  await page.getByRole("option", { name: /Deterministic/ }).click();
  await expect(cantReply(page)).toHaveCount(0);
  const reply = page.getByRole("textbox", { name: "Reply to session" });
  await reply.fill("still here");
  await reply.press("Enter");
  await expect(page.getByText("local:still here", { exact: true })).toBeVisible();
  await expect(page.getByText("local:keep this history", { exact: true })).toBeVisible();
});

hostedTest("signed out, the session says so and links to Providers; Try again keeps it readable until then", async ({ page, request }) => {
  await page.goto("/");
  const id = await ask(page, "before signing out");
  await request.post("/api/providers/logout", { data: { provider } });
  await command(request, { type: "reload", sessionId: id });
  await expect(cantReply(page)).toContainText("Can’t reply: you’re not signed in to");
  await expect(cantReply(page).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "#/settings/providers");
  await expect(page.getByText("local:before signing out", { exact: true })).toBeVisible();
  // Try again while still signed out keeps it readable.
  await cantReply(page).getByRole("button", { name: "Try again" }).click();
  await expect(cantReply(page)).toBeVisible();
  // The phone layout fits it too.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cantReply(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
