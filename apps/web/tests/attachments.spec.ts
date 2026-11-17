import { expect } from "@playwright/test";
import { hostedTest as test } from "./isolated-host";

/** A 2×2 red PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==",
  "base64",
);

test("attachments sit in the text where they were added, go with the message, and show in place in the conversation", async ({ page }) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(page.getByRole("button", { name: "Start session" })).not.toHaveAttribute("aria-disabled", "true");

  // Ask: text, then two files at the cursor, then more text. The files wait in the browser until Send.
  await ask.click();
  await ask.pressSequentially("See ");
  await page.locator('form[aria-label="New session"] input[type="file"]').setInputFiles([
    { name: "shot.png", mimeType: "image/png", buffer: PNG },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("line one\nline two") },
  ]);
  await expect(ask.getByRole("img", { name: /^shot\.png/ })).toBeVisible();
  await expect(ask.getByRole("img", { name: /^notes\.txt/ })).toBeVisible();
  await ask.pressSequentially("and fix it");
  await ask.press("Enter");

  // The message keeps its order: text, the image's thumbnail, the file's chip, text.
  const bubble = page.locator(".user-bubble").first();
  await expect(bubble.locator("a.named-image img")).toHaveAttribute("alt", "shot.png");
  await expect(bubble.locator("a.named-file")).toContainText("notes.txt");
  await expect(bubble).toContainText(/See\s+.*and fix it/s);
  const html = await bubble.innerHTML();
  expect(html.indexOf("shot.png")).toBeLessThan(html.indexOf("notes.txt"));
  // The attachment opens from the session's own files.
  const href = await bubble.locator("a.named-file").getAttribute("href");
  expect(href).toMatch(/^\/api\/sessions\/[\w-]+\/attachments\/notes\.txt$/);
  expect(await (await page.request.get(href!)).text()).toBe("line one\nline two");
  // The agent got each file named where it was, as an absolute path into the session's files, and the image as content.
  const id = href!.split("/")[3];
  const items = await (await page.request.get(`/api/sessions/${id}/items`)).json();
  const user = items.items.find((item: { role: string }) => item.role === "user");
  const sent = user.parts.find((part: { type: string }) => part.type === "text").text as string;
  expect(sent).toMatch(/^See <file name="[^"]*[\\/]sessions[\\/][\w-]+[\\/]files[\\/]shot\.png"><\/file>\s*<file name="[^"]*notes\.txt"><\/file>\s*and fix it$/);
  expect(user.parts.filter((part: { type: string }) => part.type === "image")).toHaveLength(1);

  // A reply uploads at once; Backspace removes a chip like one character.
  const reply = page.getByRole("textbox", { name: "Reply to session" });
  await reply.click();
  await reply.pressSequentially("Also ");
  await page.locator('form[aria-label="Reply to session"] input[type="file"]').setInputFiles({
    name: "extra.log",
    mimeType: "text/plain",
    buffer: Buffer.from("x"),
  });
  const chip = reply.getByRole("img", { name: /^extra\.log/ });
  await expect(chip).toBeVisible();
  await expect(chip).not.toHaveAttribute("data-state", "working");
  await reply.press("End");
  await reply.press("Backspace"); // the space after the chip
  await reply.press("Backspace"); // the chip
  await expect(chip).toHaveCount(0);
  await expect(reply).toHaveText("Also ");

  // A file over the limit is refused in place, and Send waits until it is removed.
  await reply.pressSequentially("big ");
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('form[aria-label="Reply to session"] input[type="file"]')!;
    // Refused in the browser before any upload, so the bytes never leave the page.
    const big = new File([new Uint8Array(101 * 1024 * 1024)], "huge.bin");
    const data = new DataTransfer();
    data.items.add(big);
    input.files = data.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(reply.getByRole("img", { name: /huge\.bin.*over 100 MB/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toHaveAttribute("aria-disabled", "true");
});
