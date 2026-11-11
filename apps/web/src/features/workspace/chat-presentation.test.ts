import { expect, test } from "vitest";
import { chatName, chatStatus, commandUncertainty, folderName } from "./chat-presentation";
import type { SessionInfo } from "../../../../server/src/contract/protocol";
const chat: SessionInfo = {
  id: "private-uuid",
  createdAt: "2026-01-02T03:04:00Z",
  folder: "/home/me/project",
  persona: { id: "default", name: "Default", layered: false },
  status: "idle",
  interrupted: false,
};
test("one friendly title policy handles new, legacy, unavailable dates and explicit stored names", () => {
  expect(
    chatName({ ...chat, title: "My first question", hasHistory: false }),
  ).toBe("My first question");
  expect(chatName({ ...chat, hasHistory: false })).toBe("New chat");
  for (const hasHistory of [true, undefined]) {
    expect(chatName({ ...chat, hasHistory })).toBe("Untitled chat");
    expect(chatName({ ...chat, hasHistory, createdAt: "invalid" })).toBe(
      "Untitled chat",
    );
    expect(chatName({ ...chat, hasHistory, createdAt: "" })).toBe(
      "Untitled chat",
    );
  }
  expect(chatName()).toBe("This chat");
  expect(chatName(chat)).not.toMatch(/private-uuid|revision-setup/);
});
test("normal status is quiet and cancellation/agent errors remain distinct", () => {
  for (const status of ["idle", "unloaded", undefined])
    expect(chatStatus(status)).toBe("");
  expect(chatStatus("running")).toBe("Working…");
  expect(chatStatus("cancelling")).toBe("Stopping…");
  expect(chatStatus("starting")).toBe("Opening…");
  expect(chatStatus("error")).toBe("Needs attention");
  expect(chatStatus("unloaded", true)).toBe("Needs attention");
  // A question an extension asked comes first while the run waits on it.
  expect(chatStatus("running", false, true)).toBe("Waiting for you");
  expect(chatStatus("idle", false, true)).toBe("");
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
