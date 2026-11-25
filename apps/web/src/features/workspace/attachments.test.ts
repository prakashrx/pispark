import { expect, test } from "vitest";
import { ATTACHMENT_MAX_BYTES, Attachments, BLOCKED } from "./attachments.svelte";

test("an attachment's problem is a value; its words are drawn from it", () => {
  const attachments = new Attachments();
  const big = new File([], "huge.bin");
  Object.defineProperty(big, "size", { value: ATTACHMENT_MAX_BYTES + 1 });
  const [id] = attachments.add([big]);
  expect(attachments.items[id!]?.problem).toBe("too-big");
  expect(attachments.tokens[id!]?.detail).toBe("over 100 MB");
  expect(attachments.blocked).toBe("failed");
  expect(BLOCKED[attachments.blocked!]).toBe("Remove the attachment that could not be added.");
  attachments.remove(id!);
  expect(attachments.blocked).toBeUndefined();
});
