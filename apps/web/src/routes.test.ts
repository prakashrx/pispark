import { expect, test } from "vitest";
import { href, parseRoute, settingsSections, type Route } from "./routes";

test("every screen's address reads back as the same screen", () => {
  const screens: Route[] = [
    { name: "home" },
    { name: "new" },
    { name: "session", id: "a1/b c" },
    { name: "session", id: "a1", panel: "details" },
    { name: "session", id: "a1", panel: "tasks" },
    { name: "archived" },
    { name: "agents" },
    { name: "agents", id: "shop dev" },
    { name: "background" },
    { name: "settings" },
    ...Object.keys(settingsSections).map((section) => ({ name: "settings", section }) as Route),
  ];
  for (const route of screens) expect(parseRoute(href(route))).toEqual(route);
});

test("an unknown or partial address goes home, never to an inherited name", () => {
  for (const hash of ["", "#", "#/", "#/missing", "#/toString", "#/__proto__", "#/s", "#/s/"])
    expect(parseRoute(hash)).toEqual({ name: "home" });
  expect(parseRoute("#/settings/toString")).toEqual({ name: "settings" });
  expect(parseRoute("#/settings/nope")).toEqual({ name: "settings" });
  expect(parseRoute("#agents")).toEqual({ name: "agents" });
  expect(parseRoute("#/s/a1/details/nope")).toEqual({ name: "session", id: "a1", panel: "details" });
  expect(parseRoute("#/s/a1/other")).toEqual({ name: "session", id: "a1" });
});
