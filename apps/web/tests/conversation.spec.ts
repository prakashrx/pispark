import { expect } from "@playwright/test";
import { hostedTest as test } from "./isolated-host";

test("tool calls in one answer read as one activity that opens into its calls", async ({ page }) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(page.getByRole("button", { name: "Start chat" })).not.toHaveAttribute("aria-disabled", "true");
  await ask.fill('tools:[{"name":"read","args":{"path":"sample.txt"}},{"name":"read","args":{"path":"sample.txt"}}]');
  await ask.press("Enter");
  // Two calls, no words between them: one line, closed, and the reply follows it.
  const activity = page.getByRole("button", { name: "Read 1 file" });
  await expect(activity).toBeVisible();
  await expect(activity).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText(/^local:/)).toBeVisible();
  const rows = page.getByRole("button", { name: /^Read sample\.txt/ });
  await expect(rows).toHaveCount(0);
  await activity.focus();
  await page.keyboard.press("Enter");
  await expect(activity).toHaveAttribute("aria-expanded", "true");
  await expect(rows).toHaveCount(2);
  // A call opens to what it returned.
  await rows.first().press("Enter");
  await expect(page.getByText("native browser tool result").first()).toBeVisible();
  await activity.press("Enter");
  await expect(rows).toHaveCount(0);
});

test("older messages read in as you scroll up and the view stays where it was", async ({ page, request }) => {
  test.setTimeout(150_000);
  const command = async (body: Record<string, unknown>) => {
    const response = await request.post("/api/commands", { data: { commandId: crypto.randomUUID(), ...body } });
    let receipt = await response.json();
    while (receipt.state === "accepted") {
      await new Promise((resolve) => setTimeout(resolve, 100));
      receipt = await (await request.get(`/api/receipts/${receipt.commandId}`)).json();
    }
    return receipt;
  };
  const { home } = await (await request.get("/api/catalog")).json();
  const { sessionId } = await command({ type: "create", folder: home });
  for (let n = 1; n <= 22; n++) await command({ type: "start", sessionId, text: `turn ${n}` });

  await page.goto("/");
  const main = page.getByRole("main", { name: "Chat conversation" });
  // The newest end of the chat, scrolled to the bottom, without the oldest turns.
  await expect(page.getByText("local:turn 22", { exact: true })).toBeVisible();
  await expect(page.getByText("local:turn 1", { exact: true })).toHaveCount(0);
  await expect.poll(() => main.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(5);

  // Scrolling to the top reads the older items in above, and what was in view stays in view.
  const anchor = page.getByText("turn 3", { exact: true });
  await main.evaluate((el) => (el.scrollTop = 0));
  await expect(page.getByText("local:turn 1", { exact: true })).toHaveCount(1);
  await main.evaluate((el) => (el.scrollTop = 120));
  const before = (await anchor.boundingBox())!.y;
  await main.evaluate((el) => (el.scrollTop += 0));
  expect(Math.abs((await anchor.boundingBox())!.y - before)).toBeLessThan(2);

  // Away from the bottom, new output does not pull the view down; "Jump to latest" returns to it.
  const jump = page.getByRole("button", { name: "Jump to latest" });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(jump).toHaveCount(0);
  await expect.poll(() => main.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(5);
});
