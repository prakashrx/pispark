import { afterEach, expect, test } from "vitest";
import { layout } from "../../shell/layout.svelte";
import { router } from "../../shell/router.svelte";
import { details } from "./details.svelte";

afterEach(() => {
  localStorage.clear();
  layout.size = "expanded";
  layout.width = 1440;
  layout.sidebarHidden = false;
});

test("where the panel fits, Details open by default and the choice is remembered", () => {
  layout.size = "expanded";
  layout.width = 1440;
  router.route = { name: "session", id: "a" };
  details.close("a");
  details.toggle("a");
  expect(details.view("a")).toBe("details");
  details.toggle("a");
  expect(details.view("a")).toBeUndefined();
  expect(localStorage.getItem("pispark.details")).toBe("closed");
  details.toggle("a");
  expect(localStorage.getItem("pispark.details")).toBe("open");
});

test("a view opened from Details goes back to them, and only for its session", () => {
  layout.width = 1440;
  router.route = { name: "session", id: "a" };
  details.show("a", "tasks", "p1");
  expect(details.view("a")).toBe("tasks");
  expect(details.focus("a")).toBe("p1");
  expect(details.view("b")).toBe("details");
  details.back("a");
  expect(details.view("a")).toBe("details");
  expect(details.focus("a")).toBeUndefined();
});

test("where the panel lays over the conversation, it starts closed and opening it is not remembered", () => {
  layout.size = "medium";
  layout.width = 820;
  router.route = { name: "session", id: "a" };
  expect(layout.panelFits).toBe(false);
  expect(details.view("a")).toBeUndefined();
  details.toggle("a");
  expect(details.view("a")).toBe("details");
  expect(details.view("b")).toBeUndefined();
  expect(localStorage.getItem("pispark.details")).toBeNull();
});

test("on compact, Details are a screen with an address", () => {
  layout.size = "compact";
  layout.width = 390;
  details.show("a", "tasks", "p1");
  expect(window.location.hash).toBe("#/s/a/details/tasks");
  expect(details.focus("a")).toBe("p1");
});
