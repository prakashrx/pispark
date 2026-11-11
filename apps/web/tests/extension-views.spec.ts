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

test("an extension's page takes the chat area, loads its own image and data file, and the conversation stays one click away", async ({
  page,
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
  await ask.fill("hello");
  await ask.press("Enter");
  const reply = page.getByRole("textbox", { name: "Reply to chat" });
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
  // No page yet: no switch.
  const show = page.getByRole("radiogroup", { name: "Show" });
  await expect(show).toHaveCount(0);

  // The extension places a page: it takes the chat area, and the reply box steps aside.
  await reply.fill("/page");
  await reply.press("Enter");
  const area = page.locator('[data-slot="chat.page"]');
  await expect(area.getByRole("heading", { name: "Fixture page" })).toBeVisible();
  await expect(reply).toHaveCount(0);
  await expect(page.getByRole("main", { name: "Chat page" })).toBeVisible();
  // A file the component imported, and a data file from the folder its placement named.
  const mark = area.getByRole("img", { name: "Fixture mark" });
  await expect.poll(() => mark.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(area.getByRole("listitem")).toHaveText(["First listing", "Second listing"]);
  // The page has the whole width of the chat area, not the conversation's column.
  const main = (await page.getByRole("main").boundingBox())!;
  expect((await area.boundingBox())!.width).toBeGreaterThan(main.width - 2);
  // The chat's header stays: its title, the extension's chip and the switch.
  await expect(page.locator('[data-slot="chat.title"]')).toHaveText("fixture chip");

  // The conversation is the other half of the switch, by mouse and by keyboard.
  await expect(show.getByRole("radio", { name: "Page" })).toBeChecked();
  await show.getByText("Chat", { exact: true }).click();
  await expect(area).toHaveCount(0);
  await expect(reply).toBeVisible();
  await expect(page.getByRole("main", { name: "Chat conversation" })).toBeVisible();
  await show.getByRole("radio", { name: "Chat" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(area.getByRole("heading", { name: "Fixture page" })).toBeVisible();

  // The choice belongs to the chat: it is still the page after visiting another screen.
  await page.goto("/#/settings");
  await page.goto("/#/workspace");
  await expect(area.getByRole("heading", { name: "Fixture page" })).toBeVisible();

  // When the extension removes its page, the conversation and the reply box are back.
  await show.getByText("Chat", { exact: true }).click();
  await reply.fill("/page off");
  await reply.press("Enter");
  await expect(show).toHaveCount(0);
  await expect(reply).toBeVisible();

  expect(errors).toEqual([]);
});
