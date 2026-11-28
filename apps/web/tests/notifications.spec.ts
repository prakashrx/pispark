import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { hostedTest } from "./isolated-host";
import { newSession } from "./ask";

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
}

hostedTest(
  "a session that did something while you were elsewhere is unread, on every device, until you look",
  async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await ask(page, "earlier work");
    const sessions = await (await request.get("/api/sessions")).json();
    const id = sessions.sessions.find((s: { title?: string }) => s.title === "earlier work").id;
    await ask(page, "something else");

    // The first session replies while another is on screen: bold, with a dot.
    await command(request, { type: "start", sessionId: id, text: "more work" });
    const row = page.getByRole("link", { name: /^earlier work/ }).first();
    await expect(row.locator(".unread")).toBeVisible();
    await expect(page.getByTitle("New since you looked")).toBeVisible();

    // Looking at it reads it.
    await row.click();
    await expect(page.getByText("local:more work", { exact: true })).toBeVisible();
    await expect(row.locator(".unread")).toHaveCount(0);
    expect((await (await request.get("/api/sessions")).json()).sessions.find((s: { id: string }) => s.id === id).unread).toBeUndefined();
  },
);

hostedTest("Settings → Notifications: this device, what the browser allows, and what to be told", async ({ page, context }) => {
  await page.goto("/#/settings/notifications");
  await context.grantPermissions(["notifications"], { origin: new URL(page.url()).origin });
  await page.reload();
  const device = page.getByRole("region", { name: "This device" });
  await expect(device).toContainText("✓ Allowed");
  await expect(
    device
      .getByRole("switch", { name: "Notifications on this device" })
      .or(device.getByRole("checkbox", { name: "Notifications on this device" })),
  ).toBeVisible();
  const told = page.getByRole("region", { name: "Tell me when" });
  for (const label of ["A session needs you", "A run fails", "A long run finishes", "A schedule or routine fails"])
    await expect(told).toContainText(label);
  await expect(told).toContainText("learns only that something happened");
  await expect(page.getByRole("link", { name: /Notifications/ }).first()).toBeVisible();
});
