import { render, screen } from "@testing-library/svelte";
import { expect, test } from "vitest";
import type { StyledLine } from "../../../../server/src/contract/protocol";
import ExtensionBlock from "./ExtensionBlock.svelte";

const line = (text: string): StyledLine[] => [[{ text }]];

test("other notices are words in the page's font; an extension's own message keeps its terminal text", () => {
  const { container } = render(ExtensionBlock, { lines: line("Disk almost full"), kind: "warning" });
  expect(container.querySelector(".styled-text")?.classList.contains("prose")).toBe(true);
  expect(screen.getByText("Warning")).toBeTruthy();
  const own = render(ExtensionBlock, { lines: line("col1  col2") });
  expect(own.container.querySelector(".styled-text")?.classList.contains("prose")).toBe(false);
});
