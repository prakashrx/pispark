import { expect, test, vi } from "vitest";
import { importText, textError } from "./text-import";
function file(bytes: number[] | string, name = "note.md", type = "") {
  const data =
    typeof bytes === "string"
      ? new TextEncoder().encode(bytes)
      : new Uint8Array(bytes);
  return {
    name,
    type,
    size: data.byteLength,
    arrayBuffer: vi.fn(async () => data.buffer),
  } as unknown as File;
}
test("strict UTF-8, BOM, Unicode and exact newline preservation", async () => {
  expect(await importText(file("\ufeffhé\r\nnext\n"), 100)).toBe(
    "hé\r\nnext\n",
  );
  expect(
    await importText(file("literal instructions.md", "x", "text/plain"), 100),
  ).toBe("literal instructions.md");
  expect(textError("éé", 3)).toContain("UTF-8 bytes");
});
test("empty, invalid encoding, binary controls, PDF/image/MIME and absent extension are rejected", async () => {
  for (const bad of [
    file(" \n"),
    file([0xc3, 0x28]),
    file([65, 0]),
    file([65, 1]),
    file("%PDF", "x.pdf", "application/pdf"),
    file("%PDF-1.7", "fake.txt", "text/plain"),
    file("GIF89a", "fake.md"),
    file("x", "x.md", "image/png"),
    file("x", "x.bin"),
    file("x", "x.txt", "application/octet-stream"),
  ])
    await expect(importText(bad, 100)).rejects.toThrow();
});
test("bound bytes before reading and check returned buffer independently", async () => {
  const large = file("éé");
  await expect(importText(large, 3)).rejects.toThrow("at most");
  expect(large.arrayBuffer).not.toHaveBeenCalled();
  const lying = { ...file("larger"), size: 1 } as File;
  await expect(importText(lying, 3)).rejects.toThrow("at most");
  expect(await importText(file("exact"), 5)).toBe("exact");
});
