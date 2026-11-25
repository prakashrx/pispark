import { render } from "@testing-library/svelte";
import { expect, test, vi } from "vitest";
import type { Segment } from "../session-turns";

vi.mock("../session-client.svelte", () => ({ useSessions: () => ({ sessions: [], open: () => {} }) }));
const { default: Status } = await import("./Status.svelte");

const line = (extra: Partial<Extract<Segment, { kind: "status" }>>) =>
  render(Status, { segment: { kind: "status", key: "s", title: "tests", how: "exited 1", ...extra } });
const mark = (container: HTMLElement) => container.querySelector("svg")?.outerHTML ?? "";

test("a status line's mark follows the outcome the server sent, not its words", () => {
  const failed = mark(line({ how: "finished", ok: false }).container);
  const fine = mark(line({ how: "exited 1", ok: true }).container);
  const unsaid = mark(line({ how: "printed a line matching ERROR" }).container);
  expect(new Set([failed, fine, unsaid]).size).toBe(3);
});
