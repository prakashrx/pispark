import { sessionImageUrl } from "../features/files/file-kinds";
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

test("only current session artifact images become clickable images in Markdown", () => {
  const root = document.createElement("div");
  const images = { scope: "a", source: (href: string) => sessionImageUrl("a", href) };
  root.innerHTML = renderMarkdown([
    "![A & B](files/preview%20one.png)",
    "![Remote](https://example.org/secret.png)",
    "![Other](/api/sessions/b/attachments/other.png)",
    "![Escape](files/../escape.png)",
    '<img src="/api/sessions/a/attachments/raw.png" onerror="alert(1)">',
  ].join("\n\n"), images);
  const [img] = root.querySelectorAll("img");
  expect(root.querySelectorAll("img")).toHaveLength(1);
  expect(img?.alt).toBe("A & B");
  expect(img?.getAttribute("src")).toBe("/api/sessions/a/attachments/preview%20one.png");
  expect(img?.closest("a")?.getAttribute("href")).toBe(img?.getAttribute("src"));
  expect(markdownBlocks("![Preview](files/preview.png)", false, images)[0]).toContain("/sessions/a/");
  expect(markdownBlocks("![Preview](files/preview.png)", false, {
    scope: "b", source: (href) => sessionImageUrl("b", href),
  })[0]).toContain("/sessions/b/");
});
