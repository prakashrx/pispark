import { expect } from "@playwright/test";
import { hostedTest as test } from "./isolated-host";

// The "Extension views" persona loads an ordinary Pi extension that places its own Svelte components
// at the session's contribution points with Pi's event bus (apps/server/test/fixtures/view-extension).
test("an extension's own Svelte components appear at the session's points, answer calls, follow the theme and keep their state", async ({
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
  await expect(page.locator('[data-point="session.header"]')).toHaveText("Fixture banner");
  const counter = page.locator('[data-point="session.input.above"]');
  await expect(counter.getByText("Count 0", { exact: true })).toBeVisible();
  await expect(page.locator('[data-point="session.title"]')).toHaveText("fixture chip");
  await expect(page.locator('[data-point="session.status"]')).toHaveText("Fixture footer");
  const toggle = page.locator('[data-point="session.input.actions"]').getByRole("button", { name: "Fixture mode" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // item.tool:shout: the call is drawn by the extension's component, from Pi's details.
  await expect(page.locator('[data-point="item.tool:shout"]')).toHaveText("Shouted HI");

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

  // item.custom:note: a custom entry drawn by the extension's component from the entry's own data.
  const reply = page.getByRole("textbox", { name: "Reply to chat" });
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
  await reply.fill("/note saved");
  await reply.press("Enter");
  await expect(page.locator('[data-point="item.custom:note"]')).toHaveText("Note: saved");

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
  await expect(page.locator('[data-point="item.tool:shout"]')).toHaveText("Shouted HI");
  await expect(page.locator('[data-point="item.custom:note"]')).toHaveText("Note: saved");

  expect(errors).toEqual([]);
});

test("an extension offers whole views of the session: the person switches, the choice is remembered, a view may ask to be shown, and commands are a menu", async ({
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
  const ready = () => expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
  await ready();
  // No view offered yet: no switch.
  const show = page.getByRole("radiogroup", { name: "Show" });
  await expect(show).toHaveCount(0);

  // The commands the extension registered with Pi are a menu in the header. Escape closes it and
  // focus returns to its button; choosing one sends it as if it were typed in the reply box.
  const commands = page.getByRole("button", { name: "Commands" });
  await commands.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Commands" });
  // (The persona's other fixture extension registers the first one.)
  await expect(menu.getByRole("menuitem")).toHaveText([
    "unsupported-reload",
    "page — Offer the fixture page; 'show' asks to show it",
    "note",
  ]);
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(commands).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "page — Offer" })).toBeFocused();
  await page.keyboard.press("Enter");

  // The view is offered, not shown: the conversation stays until the person chooses.
  await expect(show.locator("label")).toHaveText(["Conversation", "Fixture page"]);
  await expect(show.getByRole("radio", { name: "Conversation" })).toBeChecked();
  await expect(reply).toBeVisible();
  const area = page.locator('[data-point="session.view"]');
  await expect(area).toHaveCount(0);

  // By keyboard: the arrow keys move through the switch, and focus stays on it.
  await show.getByRole("radio", { name: "Conversation" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(area.getByRole("heading", { name: "Fixture page" })).toBeVisible();
  await expect(show.getByRole("radio", { name: "Fixture page" })).toBeChecked();
  await expect(show.getByRole("radio", { name: "Fixture page" })).toBeFocused();
  // The view has the area under the header, at its whole width; the reply box steps aside.
  await expect(reply).toHaveCount(0);
  await expect(page.getByRole("main", { name: "Fixture page" })).toBeVisible();
  const main = (await page.getByRole("main").boundingBox())!;
  expect((await area.boundingBox())!.width).toBeGreaterThan(main.width - 2);
  await expect(page.locator('[data-point="session.title"]')).toHaveText("fixture chip");
  // A file the component imported, and a data file from the folder its offer named.
  const mark = area.getByRole("img", { name: "Fixture mark" });
  await expect.poll(() => mark.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(area.getByRole("listitem")).toHaveText(["First listing", "Second listing"]);

  // The choice is remembered for this session: the same view shows after the page is loaded again.
  await page.reload();
  await expect(area.getByRole("heading", { name: "Fixture page" })).toBeVisible();
  await show.getByRole("radio", { name: "Fixture page" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(show.getByRole("radio", { name: "Conversation" })).toBeFocused();
  await expect(area).toHaveCount(0);
  await expect(page.getByRole("main", { name: "Chat conversation" })).toBeVisible();
  await page.reload();
  await expect(reply).toBeVisible();
  await expect(show.getByRole("radio", { name: "Conversation" })).toBeChecked();

  // A view that asks to be shown is shown; focus, which was in the reply box, moves to the view's region.
  await ready();
  await reply.fill("/page show");
  await reply.press("Enter");
  await expect(area.getByRole("heading", { name: "Fixture page" })).toBeVisible();
  await expect(page.getByRole("main", { name: "Fixture page" })).toBeFocused();
  // It asked once: the person switches back, and another offer does not move them.
  await show.getByText("Conversation", { exact: true }).click();
  await ready();
  await reply.fill("/page second");
  await reply.press("Enter");
  await expect(show.locator("label")).toHaveText(["Conversation", "Fixture page", "Second page"]);
  await expect(show.getByRole("radio", { name: "Conversation" })).toBeChecked();

  // Narrow: the switch stays inside the header and nothing scrolls sideways, in either view.
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(show).toBeVisible();
  expect(await fits()).toBe(true);
  const track = (await show.boundingBox())!;
  expect(track.x).toBeGreaterThanOrEqual(0);
  expect(track.x + track.width).toBeLessThanOrEqual(390);
  await show.getByText("Fixture page", { exact: true }).click();
  await expect(area.getByRole("heading", { name: "Fixture page" })).toBeVisible();
  expect(await fits()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // When the extension removes the view that shows, the conversation is back and focus is in its region.
  await area.getByRole("button", { name: "Remove this page" }).focus();
  await page.keyboard.press("Enter");
  await expect(area).toHaveCount(0);
  await expect(show.locator("label")).toHaveText(["Conversation", "Second page"]);
  await expect(reply).toBeVisible();
  await expect(page.getByRole("main", { name: "Chat conversation" })).toBeFocused();

  expect(errors).toEqual([]);
});
