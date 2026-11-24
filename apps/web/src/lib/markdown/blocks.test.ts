import { describe, expect, it } from "vitest";
import { lineEndings, sourceBlocks } from "./blocks";

const doc = [
  "---",
  "name: review",
  "description: Review code",
  "---",
  "# Review",
  "",
  "Read the diff  ",
  "first.",
  "",
  "",
  "- one",
  "- two",
  "",
  "```ts",
  "const a = 1;",
  "",
  "const b = 2;",
  "```",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "See [the guide][g].",
  "",
  "[g]: https://example.com",
  "",
].join("\n");

describe("source blocks", () => {
  it("covers the text exactly: each block is its source, and only blank lines lie between", () => {
    const blocks = sourceBlocks(doc);
    expect(blocks.map((b) => b.kind)).toEqual(["frontmatter", "heading", "paragraph", "list", "code", "table", "paragraph", "def"]);
    for (const block of blocks) expect(doc.slice(block.start, block.start + block.source.length)).toBe(block.source);
    let end = 0;
    for (const block of blocks) {
      expect(doc.slice(end, block.start).trim()).toBe("");
      end = block.start + block.source.length;
    }
    expect(doc.slice(end).trim()).toBe("");
    expect(blocks.find((b) => b.kind === "paragraph" && b.source.startsWith("See"))!.html).toContain('href="https://example.com"');
  });

  it("gives Windows and mixed line endings back, touching only what changed", () => {
    const { lf, restore } = lineEndings("One.\r\n\r\nTwo.\r\n");
    expect(lf).toBe("One.\n\nTwo.\n");
    expect(restore("Uno.\nline two\n\nTwo.\n")).toBe("Uno.\r\nline two\r\n\r\nTwo.\r\n");
    expect(restore(lf)).toBe("One.\r\n\r\nTwo.\r\n");
    expect(lineEndings("a\nb").restore("a\nc")).toBe("a\nc");
    const mixed = lineEndings("Top.\n\nOne.\r\n\r\nTwo.\r\n");
    expect(mixed.restore("Top.\n\nUno.\n\nTwo.\n")).toBe("Top.\n\nUno.\r\n\r\nTwo.\r\n");
  });
});
