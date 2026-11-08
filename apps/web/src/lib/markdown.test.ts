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
