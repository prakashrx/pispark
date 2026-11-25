import { render, screen } from "@testing-library/svelte";
import { expect, test } from "vitest";
import type { Answered as Said } from "../../../../../server/src/contract/protocol";
import Answered from "./Answered.svelte";

const show = (answered: Said) => render(Answered, { segment: { kind: "answered", key: "a", answered } });

test("an answered question reads as the question and what was said, in words", () => {
  show({ question: "Schedule this in this session?", said: "no" });
  expect(screen.getByRole("status").textContent).toContain("Schedule this in this session?");
  expect(screen.getByText("no")).toBeTruthy();
});

test("a choice is the option; a skipped or typed answer says only that", () => {
  show({ question: "Pick one", said: "chose", choice: "two" });
  expect(screen.getByText("two")).toBeTruthy();
  show({ question: "Name", said: "answered" });
  expect(screen.getByText("answered")).toBeTruthy();
  show({ question: "Proceed?", said: "skipped" });
  expect(screen.getByText("skipped")).toBeTruthy();
});
