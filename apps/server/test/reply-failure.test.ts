import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { providerMessage, replyFailure } from "../src/core/runtime/errors.js";

const failed = (errorMessage: string, provider = "anthropic") => ({ stopReason: "error", errorMessage, provider }) as AssistantMessage;

test("a failed reply says why in a person's terms, using Pi's own rules for what is transient and what overflows", () => {
  assert.equal(replyFailure(failed("The usage limit has been reached", "openai-codex")), "usage-limit");
  assert.equal(replyFailure(failed("insufficient_quota: You exceeded your current quota")), "usage-limit");
  assert.equal(replyFailure(failed("Your credit balance is too low to access the API")), "usage-limit");
  assert.equal(replyFailure(failed("529 Overloaded")), "unavailable");
  assert.equal(replyFailure(failed("fetch failed")), "unavailable");
  assert.equal(replyFailure(failed("prompt is too long: 210000 tokens > 200000 maximum")), "context-full");
  assert.equal(replyFailure(failed("401 Unauthorized: invalid x-api-key")), "signed-out");
  assert.equal(replyFailure(failed("Something unexpected")), "failed");
});

test("the provider's words are shown cleaned: no keys, tokens or paths, one bounded paragraph", () => {
  const text = providerMessage(
    "401: invalid key sk-ant-api03-abcdefghijklmnop for Bearer eyJhbGciOiJIUzI1NiJ9.x.y\n  reading C:\\Users\\me\\.pi\\auth.json and /home/me/.config/x.json; id 0123456789abcdef0123456789abcdef",
  )!;
  assert.doesNotMatch(text, /sk-ant|eyJ|Users|home\/me|0123456789abcdef0123/);
  assert.match(text, /^401: invalid key \[hidden\] for Bearer \[hidden\] reading \[path\] and \[path\]; id \[hidden\]$/);
  assert.equal(providerMessage("x".repeat(30).split("").join(" ").repeat(20))!.length, 400);
  assert.equal(providerMessage("   "), undefined);
});
