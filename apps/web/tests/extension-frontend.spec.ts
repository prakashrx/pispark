import { expect } from "@playwright/test";
import { hostedTest as test } from "./isolated-host";

// The "Custom frontend" persona loads an ordinary Pi extension whose one component is its own
// frontend for the chat (apps/server/test/fixtures/frontend-extension). It is built only from the
// `session` every component is given: no part of PiSpark's own conversation.
test("an extension's own frontend runs the chat: it shows the messages as they come, sends, answers a question, and PiSpark's frontend shows the same chat", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Persona: Default" }).click();
  await page.getByRole("option", { name: "Custom frontend", exact: true }).click();
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("hello");
  await ask.press("Enter");

  // The extension's frontend is what shows: the first message and its answer, from the session.
  const log = page.getByRole("region", { name: "Log frontend" });
  await expect(log.locator('li[data-who="you"]')).toHaveText(["you> hello"]);
  await expect(log.locator('li[data-who="pi"]')).toHaveCount(1);
  await expect(log.getByRole("status")).toHaveText("state: idle");
  // PiSpark's own reply box is not there; the chat's header is.
  await expect(page.getByRole("textbox", { name: "Reply to chat" })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Show" })).toBeVisible();

  // It sends with its own input, and the answer streams into it.
  const input = log.getByRole("textbox", { name: "Log input" });
  await input.fill("second");
  await input.press("Enter");
  await expect(log.locator('li[data-who="you"]')).toHaveText(["you> hello", "you> second"]);
  await expect(log.locator('li[data-who="pi"]')).toHaveCount(2);
  await expect(input).toHaveValue("");
  await expect(log.getByRole("status")).toHaveText("state: idle");

  // A question an extension asks reaches it, the chat is working meanwhile, and it answers.
  await input.fill("ui-confirm");
  await input.press("Enter");
  const question = log.getByRole("group", { name: "Proceed?" });
  await expect(question).toBeVisible();
  await expect(log.getByRole("status")).toHaveText("state: running");
  await question.getByRole("button", { name: "yes" }).click();
  await expect(question).toHaveCount(0);
  await expect(log.getByRole("status")).toHaveText("state: idle");

  // PiSpark's frontend is the other one for the same chat: the same messages, and its reply box.
  await page.getByRole("radiogroup", { name: "Show" }).getByText("Chat", { exact: true }).click();
  await expect(log).toHaveCount(0);
  const conversation = page.getByRole("main", { name: "Chat conversation" });
  const mine = conversation.locator(".user-bubble");
  await expect(mine).toHaveText(["hello", "second", "ui-confirm"]);
  const reply = page.getByRole("textbox", { name: "Reply to chat" });
  await reply.fill("third");
  await reply.press("Enter");
  await expect(mine).toHaveText(["hello", "second", "ui-confirm", "third"]);
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
  // Back in the extension's frontend, what was sent from PiSpark's is there too.
  await page.getByRole("radiogroup", { name: "Show" }).getByText("Page", { exact: true }).click();
  await expect(log.locator('li[data-who="you"]')).toHaveText(["you> hello", "you> second", "you> ui-confirm", "you> third"]);

  expect(errors).toEqual([]);
});
