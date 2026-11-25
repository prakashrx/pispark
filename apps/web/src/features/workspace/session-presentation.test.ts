import { expect, test } from "vitest";
import {
  commandError,
  dateGroups,
  elapsed,
  commandUncertainty,
  folderName,
  foremostState,
  goesByApp,
  sessionName,
  sessionStarted,
  sessionState,
  sessionStatus,
} from "./session-presentation";
import type { SessionInfo } from "../../../../server/src/contract/protocol";
const session: SessionInfo = {
  id: "private-uuid",
  createdAt: "2026-01-02T03:04:00Z",
  lastActivity: "2026-01-02T03:04:00Z",
  folder: "/home/me/project",
  agent: { id: "default", name: "Default", layered: false },
  status: "idle",
  interrupted: false,
};
test("one friendly title policy handles new, legacy, unavailable dates and explicit stored names", () => {
  expect(
    sessionName({ ...session, title: "My first question", hasHistory: false }),
  ).toBe("My first question");
  expect(sessionName({ ...session, hasHistory: false })).toBe("New session");
  for (const hasHistory of [true, undefined]) {
    expect(sessionName({ ...session, hasHistory })).toBe("Untitled session");
    expect(sessionName({ ...session, hasHistory, createdAt: "invalid" })).toBe(
      "Untitled session",
    );
    expect(sessionName({ ...session, hasHistory, createdAt: "" })).toBe(
      "Untitled session",
    );
  }
  expect(sessionName()).toBe("This session");
  expect(sessionName(session)).not.toMatch(/private-uuid|revision-setup/);
});
test("an app's session goes by the app's name until it has a title of its own", () => {
  const app = { ...session, hasHistory: false, agent: { id: "desk", name: "Desk project", layered: false, home: "desk" } };
  expect(goesByApp(app)).toBe(true);
  expect(sessionName(app)).toBe("Desk project");
  expect(goesByApp({ ...app, title: "Plan the release" })).toBe(false);
  expect(sessionName({ ...app, title: "Plan the release" })).toBe("Plan the release");
  expect(goesByApp(session)).toBe(false);
});
test("normal status is quiet and cancellation/agent errors remain distinct", () => {
  for (const status of ["idle", "unloaded"] as const)
    expect(sessionStatus({ status, interrupted: false })).toBe("");
  expect(sessionStatus()).toBe("");
  expect(sessionStatus({ status: "running", interrupted: false })).toBe("Working");
  expect(sessionStatus({ status: "cancelling", interrupted: false })).toBe("Stopping");
  expect(sessionStatus({ status: "starting", interrupted: false })).toBe("Opening");
  expect(sessionStatus({ status: "error", interrupted: false })).toBe("Failed");
  expect(sessionStatus({ status: "unloaded", interrupted: true })).toBe("Interrupted");
  // A question an extension asked comes first while the run waits on it.
  expect(sessionState({ status: "running", interrupted: false, waiting: true })).toBe("needs-you");
  expect(sessionStatus({ status: "running", interrupted: false, waiting: true })).toBe("Needs you");
  expect(sessionStatus({ status: "idle", interrupted: false, waiting: true })).toBe("");
  expect(sessionStatus({ status: "idle", interrupted: false, queued: true })).toBe("Queued");
  // Of several, the one a person most needs to see: Needs you, then Failed.
  expect(foremostState(["", "working", "failed"])).toBe("failed");
  expect(foremostState(["queued", "needs-you", "failed"])).toBe("needs-you");
  expect(foremostState(["", ""])).toBe("");
});
test("a refused command is said in words; an unknown code is still named", () => {
  expect(commandError("folder")).toBe("That working folder doesn’t exist on the server.");
  expect(commandError("busy")).toBe("The session is busy. Try again when it has finished.");
  expect(commandError("sdk-version")).toBe("This PiSpark doesn’t match its Pi version. Update PiSpark.");
  expect(commandError("unheard-of")).toBe("The server could not do that (unheard-of).");
});
test("a start time says the year only when it is not this year's", () => {
  const thisYear = new Date().getFullYear();
  expect(sessionStarted({ ...session, createdAt: `${thisYear}-03-04T10:00:00Z` })).not.toContain(String(thisYear));
  expect(sessionStarted({ ...session, createdAt: "2001-03-04T10:00:00Z" })).toContain("2001");
  expect(sessionStarted({ ...session, createdAt: "invalid" })).toBe("");
});

test("uncertainty primary copy distinguishes acceptance, settlement and known-session scope without interpreting raw errors", () => {
  expect(commandUncertainty("acceptance-unknown", true)).toBe(
    "We couldn’t confirm whether that action went through. Check this session before trying again.",
  );
  expect(commandUncertainty("acceptance-unknown", false)).toBe(
    "We couldn’t confirm whether that action went through. Check your sessions before trying again.",
  );
  expect(commandUncertainty("settlement-unknown", true)).toBe(
    "That action may still be running. Check this session before trying again.",
  );
  expect(commandUncertainty("settlement-unknown", false)).toBe(
    "That action may still be running. Check your sessions before trying again.",
  );
  expect(commandUncertainty(undefined, true)).toBe("");
});

test("folder labels use the last path segment on any platform", () => {
  expect(folderName("D:\\dev\\pispark")).toBe("pispark");
  expect(folderName("/home/me/project/")).toBe("project");
  expect(folderName("C:\\")).toBe("C:");
});

test("sessions group by the day they last did something, newest groups first, empty groups left out", () => {
  const now = new Date(2026, 10, 17, 15, 0);
  const at = (days: number) => ({ lastActivity: new Date(2026, 10, 17 - days, 9, 0).toISOString() });
  const groups = dateGroups([at(0), at(1), at(3), at(30), at(0)], now);
  expect(groups.map((group) => [group.label, group.items.length])).toEqual([
    ["Today", 2],
    ["Yesterday", 1],
    ["This week", 1],
    ["Older", 1],
  ]);
  expect(dateGroups([at(30)], now).map((group) => group.label)).toEqual(["Older"]);
});

test("durations read the way people say them", () => {
  expect([0, 999, 8_000, 59_999, 60_000, 102_000, 3_599_000, 3_600_000, 7_500_000, -5].map(elapsed)).toEqual([
    "0s",
    "0s",
    "8s",
    "59s",
    "1m 00s",
    "1m 42s",
    "59m 59s",
    "1h 0m",
    "2h 5m",
    "0s",
  ]);
});

test("every server error code is said in words; a code the web does not know says which", () => {
  expect(commandError("limit")).toBe("That’s more than the server accepts: too large, or too many at once.");
  expect(commandError("owned")).toBe("That session is already open.");
  expect(commandError("toString")).toBe("The server could not do that (toString).");
  expect(commandError("brand-new")).toBe("The server could not do that (brand-new).");
});
