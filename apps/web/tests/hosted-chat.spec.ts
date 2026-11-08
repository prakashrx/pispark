import { expect } from "@playwright/test";
import { hostedTest as test } from "./isolated-host";

test("saved assistant Markdown stays inert and keeps normal formatting after reopen", async ({
  page,
}) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(
    page.getByRole("button", { name: "Start chat" }),
  ).not.toHaveAttribute("aria-disabled", "true");
  const prompt =
    '**safe bold** <img src="/invalid" onerror="document.body.dataset.injected=1"> [unsafe](javascript:alert(1))';
  await ask.fill(prompt);
  await ask.press("Enter");
  const prose = page
    .locator(".prose")
    .filter({ has: page.locator("strong", { hasText: "safe bold" }) });
  for (const reopen of [false, true]) {
    if (reopen) {
      await page.getByRole("button", { name: "Chat info", exact: true }).click();
      await page.getByRole("button", { name: "Stop agent", exact: true }).click();
      await page.getByRole("button", { name: "Reopen chat" }).click();
    }
    await expect(prose).toBeVisible();
    await expect(
      prose.locator("img, [onerror], a[href^='javascript:']"),
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveAttribute(
      "data-injected",
      "1",
    );
  }
});

test("blocked browser storage supports live replies and a peer can unload and reopen the chat", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem"])
      Object.defineProperty(Storage.prototype, method, {
        value() {
          throw new DOMException("Blocked", "SecurityError");
        },
      });
  });
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(
    page.getByRole("button", { name: "Start chat" }),
  ).not.toHaveAttribute("aria-disabled", "true");
  await ask.fill("peer unload regression");
  await ask.press("Enter");
  await expect(
    page.getByText("local:peer unload regression", { exact: true }),
  ).toBeVisible();
  const reply = page.getByRole("textbox", { name: "Reply to chat" });
  await reply.fill("keep through reopen");
  const { sessions } = await (await request.get("/api/sessions")).json();
  const id = sessions.findLast(
    (s: { title: string }) => s.title === "peer unload regression",
  ).id;
  await request.post("/api/commands", {
    data: { type: "stop", commandId: crypto.randomUUID(), sessionId: id },
  });
  await expect(page.getByRole("button", { name: "Reopen chat" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Reopen chat" }).click();
  await expect(page.getByRole("img", { name: "Backend: Live" })).toBeVisible();
  await expect(reply).toHaveValue("keep through reopen");
  await reply.press("Enter");
  await expect(
    page.getByText("local:keep through reopen", { exact: true }),
  ).toBeVisible();
});

test("a clipped reply can be read through its final character", async ({
  page,
}) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(
    page.getByRole("button", { name: "Start chat" }),
  ).not.toHaveAttribute("aria-disabled", "true");
  await ask.fill("long reply " + "a".repeat(10000) + " END-OF-REPLY");
  await ask.press("Enter");
  const readers = page.getByRole("button", { name: "Read full message" });
  await expect(readers).toHaveCount(2);
  await readers.last().focus();
  await page.keyboard.press("Enter");
  const reader = page.getByRole("region", { name: "Full message text" });
  await expect(reader.locator("pre")).toContainText("local:long reply");
  await reader.getByRole("button", { name: "Next page" }).click();
  await expect(reader.locator("pre")).toContainText("END-OF-REPLY");
  await expect(reader.locator("pre")).toBeFocused();
  await reader.getByRole("button", { name: "Close full text" }).click();
  await expect(readers.last()).toBeFocused();
});
