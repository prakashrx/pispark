import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

test("local trace separates looks at a child from wakes, preserves missing usage and omits content", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "pispark-trace-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const id = "11111111-1111-4111-8111-111111111111",
    child = "22222222-2222-4222-8222-222222222222";
  const dir = join(home, "sessions", id);
  await mkdir(dir, { recursive: true });
  const records = [
    { message: { role: "user", content: "PRIVATE_INPUT" } },
    {
      message: {
        role: "assistant",
        model: "model-a",
        content: [{ type: "toolCall", id: "call-1", name: "pispark_look", arguments: { id: "session-1" } }],
      },
    },
    {
      message: { role: "toolResult", toolCallId: "call-1", toolName: "pispark_look", content: [{ type: "text", text: "PRIVATE_RESULT" }] },
    },
    { type: "custom", customType: "pispark:woken", data: { source: { kind: "session", id: child, label: "PRIVATE_TITLE" } } },
    { message: { role: "user", content: "PRIVATE_WAKE" } },
  ];
  await writeFile(join(dir, "handles.json"), JSON.stringify({ version: 1, next: 2, names: { [child]: "session-1" } }));
  await writeFile(join(dir, `fixture_${id}.jsonl`), records.map((r) => JSON.stringify(r)).join("\n") + "\n{");
  const script = fileURLToPath(new URL("../../../scripts/session-trace.mjs", import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [script, home, id]);
  assert.doesNotMatch(stdout, /PRIVATE|call-1/);
  const s = JSON.parse(stdout);
  assert.equal(s.turns[0].responses[0].fresh, null);
  assert.equal(s.turns[0].results[0].textChars, 14);
  assert.equal(s.turns[1].previousChildReadTurn, 1);
  assert.equal(s.processes, null);
  assert.equal(s.warnings.length, 2);
});
