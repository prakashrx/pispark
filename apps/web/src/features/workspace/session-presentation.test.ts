import { expect, test } from "vitest";
import {
  commandError,
  commandUncertainty,
  folderName,
  foremostStatus,
  goesByApp,
  sessionName,
  sessionStarted,
  sessionStatus,
} from "./session-presentation";
import type { SessionInfo } from "../../../../server/src/contract/protocol";
const session: SessionInfo = {
  id: "private-uuid",
  createdAt: "2026-01-02T03:04:00Z",
  folder: "/home/me/project",
  persona: { id: "default", name: "Default", layered: false },
  status: "idle",
  interrupted: false,
};
test("one friendly title policy handles new, legacy, unavailable dates and explicit stored names", () => {
  expect(
    sessionName({ ...session, title: "My first question", hasHistory: false }),
  ).toBe("My first question");
  expect(sessionName({ ...session, hasHistory: false })).toBe("New chat");
  for (const hasHistory of [true, undefined]) {
    expect(sessionName({ ...session, hasHistory })).toBe("Untitled chat");
    expect(sessionName({ ...session, hasHistory, createdAt: "invalid" })).toBe(
      "Untitled chat",
    );
    expect(sessionName({ ...session, hasHistory, createdAt: "" })).toBe(
      "Untitled chat",
    );
  }
  expect(sessionName()).toBe("This chat");
  expect(sessionName(session)).not.toMatch(/private-uuid|revision-setup/);
});
test("an app's session goes by the app's name until it has a title of its own", () => {
  const app = { ...session, hasHistory: false, persona: { id: "desk", name: "Desk project", layered: false, home: "desk" } };
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
  expect(sessionStatus({ status: "running", interrupted: false })).toBe("Working…");
  expect(sessionStatus({ status: "cancelling", interrupted: false })).toBe("Stopping…");
  expect(sessionStatus({ status: "starting", interrupted: false })).toBe("Opening…");
  expect(sessionStatus({ status: "error", interrupted: false })).toBe("Needs attention");
  expect(sessionStatus({ status: "unloaded", interrupted: true })).toBe("Needs attention");
  // A question an extension asked comes first while the run waits on it.
  expect(sessionStatus({ status: "running", interrupted: false, waiting: true })).toBe("Waiting for you");
  expect(sessionStatus({ status: "idle", interrupted: false, waiting: true })).toBe("");
  expect(sessionStatus({ status: "idle", interrupted: false, queued: true })).toBe("Queued");
  // Of several, the one a person most needs to see.
  expect(foremostStatus(["", "Working…", "Needs attention"])).toBe("Needs attention");
  expect(foremostStatus(["Queued", "Waiting for you"])).toBe("Waiting for you");
  expect(foremostStatus(["", ""])).toBe("");
});
test("a refused command is said in words; an unknown code is still named", () => {
  expect(commandError("folder")).toBe("That working folder doesn’t exist on the server.");
  expect(commandError("busy")).toBe("The chat is busy. Try again when it has finished.");
  expect(commandError("sdk-version")).toBe("The server could not do that (sdk-version).");
});
test("a start time says the year only when it is not this year's", () => {
  const thisYear = new Date().getFullYear();
  expect(sessionStarted({ ...session, createdAt: `${thisYear}-03-04T10:00:00Z` })).not.toContain(String(thisYear));
  expect(sessionStarted({ ...session, createdAt: "2001-03-04T10:00:00Z" })).toContain("2001");
  expect(sessionStarted({ ...session, createdAt: "invalid" })).toBe("");
});

test("uncertainty primary copy distinguishes acceptance, settlement and known-chat scope without interpreting raw errors", () => {
  expect(commandUncertainty("acceptance-unknown", true)).toBe(
    "We couldn’t confirm whether that action went through. Check this chat before trying again.",
  );
  expect(commandUncertainty("acceptance-unknown", false)).toBe(
    "We couldn’t confirm whether that action went through. Check your chats before trying again.",
  );
  expect(commandUncertainty("settlement-unknown", true)).toBe(
    "That action may still be running. Check this chat before trying again.",
  );
  expect(commandUncertainty("settlement-unknown", false)).toBe(
    "That action may still be running. Check your chats before trying again.",
  );
  expect(commandUncertainty(undefined, true)).toBe("");
});

test("folder labels use the last path segment on any platform", () => {
  expect(folderName("D:\\dev\\pispark")).toBe("pispark");
  expect(folderName("/home/me/project/")).toBe("project");
  expect(folderName("C:\\")).toBe("C:");
});
