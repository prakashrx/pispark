import { render, screen } from "@testing-library/svelte";
import { expect, test } from "vitest";
import type { Schedule as Saved } from "../../../../../server/src/contract/schedule-protocol";
import Schedule from "./Schedule.svelte";

const saved = (extra: Partial<Saved> = {}): Saved => ({
  id: "5e6be256-39c5-4dcb-a848-8e9cf3390a36",
  sessionId: "s",
  cron: "0 7 * * *",
  prompt: "Build the morning edition",
  on: true,
  createdAt: "2026-11-25T00:00:00.000Z",
  by: "agent",
  runs: [],
  ...extra,
});
const show = (schedule: Saved) => render(Schedule, { segment: { kind: "schedule", key: "schedule.c1", schedule } });

test("a saved schedule shows when it runs, where its runs go, and what it sends", () => {
  show(saved({ run: "new" }));
  expect(screen.getByText("Every day at 7:00 am")).toBeTruthy();
  expect(screen.getByText(/runs in a new session/)).toBeTruthy();
  expect(screen.getByText(/^Next /)).toBeTruthy();
  expect(screen.getByText("“Build the morning edition”")).toBeTruthy();
});

test("one that runs here, switched off, says so", () => {
  show(saved({ on: false }));
  expect(screen.getByText(/runs in this session/)).toBeTruthy();
  expect(screen.getByText("· off")).toBeTruthy();
});
