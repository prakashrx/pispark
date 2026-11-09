import { expect } from "@playwright/test";
import { hostedTest as test } from "./isolated-host";

// The "Extension views" persona loads an ordinary Pi extension that places its own Svelte components
// in the chat's slots with Pi's event bus (apps/server/test/fixtures/view-extension).
test("an extension's own Svelte components appear in the chat's slots, answer calls, follow the theme and keep their state", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Persona: Default" }).click();
  await page.getByRole("option", { name: "Extension views", exact: true }).click();
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill('tool:shout:{"word":"hi"}');
  await ask.press("Enter");

  // Places: shown when the extension loaded, with the props it sent; the footer replaces the status line.
  await expect(page.locator('[data-slot="chat.header"]')).toHaveText("Fixture banner");
  const counter = page.locator('[data-slot="reply.above"]');
  await expect(counter.getByText("Count 0", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="chat.title"]')).toHaveText("fixture chip");
  await expect(page.locator('[data-slot="reply.footer"]')).toHaveText("Fixture footer");
  const toggle = page.locator('[data-slot="reply.actions"]').getByRole("button", { name: "Fixture mode" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // tool:shout: the call is drawn by the extension's component, from Pi's details.
  await expect(page.locator('[data-slot="tool:shout"]')).toHaveText("Shouted HI");

  // host.call runs the extension's function: its result comes back to the component, its new
  // props arrive live, and the mounted component keeps its own state.
  await counter.getByRole("button", { name: "Add one" }).click();
  await expect(counter.getByText("Now 1", { exact: true })).toBeVisible();
  await expect(counter.getByText("Count 1", { exact: true })).toBeVisible();
  await expect(counter.getByText("1 pressed here")).toBeVisible();
  // The extension's own error reaches the component that called, not the chat.
  await counter.getByRole("button", { name: "Jam it" }).click();
  await expect(counter.getByText("The counter is jammed", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // custom:note: a custom entry drawn by the extension's component from the entry's own data.
  const reply = page.getByRole("textbox", { name: "Reply to chat" });
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
  await reply.fill("/note saved");
  await reply.press("Enter");
  await expect(page.locator('[data-slot="custom:note"]')).toHaveText("Note: saved");

  // Components style themselves with PiSpark's tokens, so they follow the theme.
  const color = () => counter.locator(".counter").evaluate((node) => getComputedStyle(node).color);
  const light = await color();
  await page.evaluate(() => (document.documentElement.dataset.theme = "midnight"));
  await expect.poll(color).not.toBe(light);

  // Unloaded on the server (as an idle chat would be), the chat opens again by itself; the
  // extension places its components again, with the count it saved in Pi's session.
  const { sessions } = await (await request.get("/api/sessions")).json();
  const id = sessions.at(-1).id;
  await request.post("/api/commands", { data: { type: "stop", commandId: crypto.randomUUID(), sessionId: id } });
  await expect(page.getByRole("img", { name: "Backend: Live" })).toBeVisible({ timeout: 10_000 });
  await expect(counter.getByText("Count 1", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="tool:shout"]')).toHaveText("Shouted HI");
  await expect(page.locator('[data-slot="custom:note"]')).toHaveText("Note: saved");

  expect(errors).toEqual([]);
});
