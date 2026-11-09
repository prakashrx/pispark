import { expect, test } from "vitest";
import { renderMarkdown } from "./markdown";

test("assistant Markdown preserves code and formatting while stripping active content", () => {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(
    [
      "**important** [docs](https://example.org/guide)",
      '<svg onload="alert(1)"></svg><img src=x onerror="alert(1)">',
      '[unsafe](javascript:alert%281%29) <a href="&#106;avascript:alert(1)">encoded</a>',
      "```html\n<script>alert(1)</script>\n```",
    ].join("\n\n"),
  );
  expect(root.querySelector("strong")?.textContent).toBe("important");
  expect(root.querySelector("pre code")?.textContent).toContain(
    "<script>alert(1)</script>",
  );
  expect(
    Array.from(root.querySelectorAll("a[href]"), (a) => a.getAttribute("href")),
  ).toEqual(["https://example.org/guide"]);
  expect(
    root.querySelector("script, svg, img, [onload], [onerror]"),
  ).toBeNull();
  const link = root.querySelector("a[href]");
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
});

import { markdownBlocks, repairOpenBlock } from "./markdown";

test("a reply is split into blocks; finished blocks do not change as the reply grows", () => {
  const text = "# Title\n\nFirst paragraph.\n\n- one\n- two\n\nLast";
  const blocks = markdownBlocks(text, true);
  expect(blocks).toHaveLength(4);
  expect(blocks[0]).toContain("<h1>Title</h1>");
  const grown = markdownBlocks(text + " words and **bo", true);
  expect(grown.slice(0, 3)).toEqual(blocks.slice(0, 3));
  expect(grown[3]).toContain("Last words and <strong>bo</strong>");
  // Finished, the whole reply renders exactly like one parse of it.
  const whole = markdownBlocks(text, false).join("");
  expect(whole).toBe(renderMarkdown(text));
});

test("half-written Markdown reads as intended: open fences, spans, emphasis and links", () => {
  expect(markdownBlocks("```ts\nconst a = 1;", true)[0]).toContain("<pre><code");
  expect(repairOpenBlock("```ts\nconst a = `1")).toBe("```ts\nconst a = `1");
  expect(repairOpenBlock("use `reduce")).toBe("use `reduce`");
  expect(repairOpenBlock("a **bold claim")).toBe("a **bold claim**");
  expect(repairOpenBlock("a *soft")).toBe("a *soft*");
  expect(repairOpenBlock("- item\n- another")).toBe("- item\n- another");
  expect(repairOpenBlock("see [the docs")).toBe("see \\[the docs");
  expect(repairOpenBlock("see [docs](https://exam")).toBe("see [docs](https://exam)");
  expect(repairOpenBlock("**done** and `code` and [x](y)")).toBe("**done** and `code` and [x](y)");
  const html = markdownBlocks("| a | b |\n|---|---|\n| 1 | 2", true)[0]!;
  expect(html).toContain("<table>");
});

test("blocks stay sanitized however they are split", () => {
  const html = markdownBlocks('<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))', false).join("");
  expect(html).not.toMatch(/onerror|javascript:/);
});
