import { beforeEach, expect, test, vi } from "vitest";
import { BlockStream, repairOpenBlock } from "./parse";
import type { FenceRenderer } from "./enhance";
import { MarkdownView, type MarkdownOptions } from "./view";

// Updates draw at once instead of on the next animation frame.
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (draw: FrameRequestCallback) => (draw(0), 0));
});

function shown(text: string, options?: MarkdownOptions): HTMLElement {
  const root = document.createElement("div");
  new MarkdownView(root, options).update(text);
  return root;
}

test("GitHub Markdown keeps what it means: task lists, alignment, footnotes and inline HTML", () => {
  const root = shown(
    [
      "- [x] done\n- [ ] to do",
      "| Name | Count |\n|:--|--:|\n| a | 1 |",
      "H<sub>2</sub>O, x<sup>2</sup>, <kbd>Ctrl</kbd>, <mark>marked</mark>",
      "<details><summary>More</summary>\n\nHidden text\n\n</details>",
      "A claim[^1].\n\n[^1]: The source.",
    ].join("\n\n"),
  );
  const boxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect([...boxes].map((box) => box.checked)).toEqual([true, false]);
  expect([...boxes].every((box) => box.disabled)).toBe(true);
  expect(root.querySelectorAll("th")[1]?.getAttribute("align")).toBe("right");
  expect(root.querySelector("sub")?.textContent).toBe("2");
  expect(root.querySelector("kbd")?.textContent).toBe("Ctrl");
  expect(root.querySelector("details summary")?.textContent).toBe("More");
  const ref = root.querySelector<HTMLAnchorElement>("a[data-footnote-ref]")!;
  const note = root.querySelector(ref.getAttribute("href")!);
  expect(note?.textContent).toContain("The source.");
  expect(ref.target).toBe("");
});

test("active content stays inert while links open outside the app", () => {
  const root = shown(
    [
      "**important** [docs](https://example.org/guide)",
      '<svg onload="alert(1)"></svg><img src=x onerror="alert(1)">',
      '[unsafe](javascript:alert%281%29) <a href="&#106;avascript:alert(1)">encoded</a>',
      '<div class="fixed inset-0" style="color:red" onclick="alert(1)">styled</div>',
      '<input type="text" value="x">',
      "```html\n<script>alert(1)</script>\n```",
    ].join("\n\n"),
  );
  expect(root.querySelector("pre code")?.textContent).toContain("<script>alert(1)</script>");
  expect([...root.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"))).toEqual(["https://example.org/guide"]);
  expect(root.querySelector("script, svg, [onload], [onerror], [onclick], [style], [class*=fixed], input")).toBeNull();
  const link = root.querySelector("a[href]")!;
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
});

test("images show from the web and from the host's own files; anything else is just its alt text", () => {
  const images = (href: string) => (href.startsWith("files/") ? `/api/sessions/a/attachments/${href.slice(6)}` : undefined);
  const root = shown(["![Chart](https://example.org/chart.png)", "![Shot](files/shot.png)", "![Other](ftp://x/y.png)"].join("\n\n"), { images });
  const sources = [...root.querySelectorAll("img")].map((img) => img.getAttribute("src"));
  expect(sources).toEqual(["https://example.org/chart.png", "/api/sessions/a/attachments/shot.png"]);
  expect(root.querySelector("img")?.closest("a")?.getAttribute("href")).toBe("https://example.org/chart.png");
  expect(root.textContent).toContain("Other");
});

test("math, code languages and known diagrams are marked for their renderers; prices stay text", () => {
  const root = shown(["Energy $E = mc^2$ and \\(a+b\\); it costs $5 and $10.", "$$\n\\int_0^1 x\\,dx\n$$", "```ts\nconst a = 1;\n```"].join("\n\n"));
  expect([...root.querySelectorAll("[data-math]")].map((m) => m.getAttribute("data-math"))).toEqual(["inline", "inline", "block"]);
  expect(root.textContent).toContain("costs $5 and $10");
  expect(root.querySelector("pre")?.dataset.lang).toBe("ts");
  expect(root.querySelector(".code-copy")?.getAttribute("aria-label")).toBe("Copy code");
});

test("typed text keeps its line breaks", () => {
  expect(shown("first line\nsecond line", { flavor: "typed" }).querySelector("br")).not.toBeNull();
  expect(shown("first line\nsecond line").querySelector("br")).toBeNull();
});

test("while text streams, finished blocks are parsed once and their elements never change", () => {
  const root = document.createElement("div");
  const view = new MarkdownView(root);
  view.update("# Title\n\nFirst paragraph.\n\nSecond", true);
  const [title, first, open] = root.children;
  const text = open!.querySelector("p")!.firstChild!;
  view.update("# Title\n\nFirst paragraph.\n\nSecond grows **bo", true);
  expect(root.children[0]).toBe(title);
  expect(root.children[1]).toBe(first);
  expect(root.children[2]).toBe(open);
  // The open block is patched: its text node grows in place.
  expect(open!.querySelector("p")!.firstChild).toBe(text);
  expect(open!.querySelector("strong")?.textContent).toBe("bo");
  view.update("# Title\n\nFirst paragraph.\n\nSecond grows **bold**.\n\n| a |\n|---|\n| 1", true);
  expect(root.children[3]?.getAttribute("role")).toBe("region");
  // Finished, it reads exactly as one parse of the whole text, in the same elements.
  view.update("# Title\n\nFirst paragraph.\n\nSecond grows **bold**.", false);
  expect(root.children[1]).toBe(first);
  expect(root.children).toHaveLength(3);
});

test("finished blocks are kept as parsed; only the last block is open", () => {
  const stream = new BlockStream("prose");
  const first = stream.update("one\n\ntwo\n\nthr", true);
  const blocks = stream.update("one\n\ntwo\n\nthree", true);
  expect(blocks[0]).toBe(first[0]);
  expect(blocks.map((block) => [block.start, block.kind, !!block.open])).toEqual([
    [0, "paragraph", false],
    [5, "paragraph", false],
    [10, "paragraph", true],
  ]);
});

test("a fenced block is drawn by a renderer for its language, and falls back to code when it fails", async () => {
  const drawn: string[] = [];
  const renderers: Record<string, FenceRenderer> = {
    chart(target, code) {
      drawn.push(code);
      target.textContent = "chart!";
    },
    broken: () => Promise.reject(new Error("no")),
  };
  const fences = (language: string) => renderers[language];
  const root = shown("```chart\nbars: 3\n```\n\n```broken\nx\n```", { fences });
  expect(drawn).toEqual(["bars: 3"]);
  expect(root.querySelector('.markdown-fence[data-lang="chart"]')?.textContent).toBe("chart!");
  await Promise.resolve();
  await Promise.resolve();
  expect(root.querySelector('pre[data-lang="broken"]')?.textContent).toContain("x");
});

test("half-written Markdown reads as intended: open fences, spans, emphasis and links", () => {
  expect(repairOpenBlock("```ts\nconst a = `1")).toBe("```ts\nconst a = `1");
  expect(repairOpenBlock("use `reduce")).toBe("use `reduce`");
  expect(repairOpenBlock("a **bold claim")).toBe("a **bold claim**");
  expect(repairOpenBlock("a *soft")).toBe("a *soft*");
  expect(repairOpenBlock("- item\n- another")).toBe("- item\n- another");
  expect(repairOpenBlock("see [the docs")).toBe("see \\[the docs");
  expect(repairOpenBlock("see [docs](https://exam")).toBe("see [docs](https://exam)");
  expect(repairOpenBlock("**done** and `code` and [x](y)")).toBe("**done** and `code` and [x](y)");
});

test("a selection in the text being written survives it growing", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const view = new MarkdownView(root);
  view.update("The sea is a vast", true);
  const text = root.querySelector("p")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 7);
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
  view.update("The sea is a vast body of water", true);
  expect(getSelection()!.toString()).toBe("The sea");
  root.remove();
});
