import { expect, test } from "vitest";
import { chatName, chatStatus, commandUncertainty, visibleTurns } from "./chat-presentation";
import type { SessionInfo } from "../../../../server/src/protocol";
const chat: SessionInfo = {
  id: "private-uuid",
  createdAt: "2026-01-02T03:04:00Z",
  workspace: "local",
  configuration: "revision-setup",
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

test("unmatched results never hide a pending tool, even when names repeat", () => {
  const calls = { role: "assistant", parts: [
    { type: "toolCall", text: "", name: "read", callId: "first" },
    { type: "toolCall", text: "", name: "read", callId: "second" },
  ] };
  const result = { role: "toolResult", toolName: "read", parts: [] };
  const turns = visibleTurns([calls, { ...result, callId: "other" }, { ...result, callId: "second" }, result]);
  expect([...turns[0]!.hidden]).toEqual([1]);
});

test("visible turns drop empty messages and settle tool calls by their later result", () => {
  const turns = visibleTurns([
    { role: "assistant", parts: [{ type: "text", text: "  " }] },
    { role: "user", parts: [{ type: "text", text: "Hi" }] },
    { role: "assistant", parts: [{ type: "toolCall", text: "", name: "a" }, { type: "toolCall", text: "", name: "b", callId: "second" }] },
    { role: "toolResult", toolName: "b", callId: "second", parts: [{ type: "text", text: "ok" }] },
    { role: "assistant", parts: [{ type: "text", text: "" }], stopReason: "aborted" },
  ]);
  expect(turns.map((t) => t.message.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
  // "a" has no result yet so its request stays visible; "b" is settled.
  expect([...(turns[1]?.hidden ?? [])]).toEqual([1]);
});
