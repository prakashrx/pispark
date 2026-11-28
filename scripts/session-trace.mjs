// On-demand local inspection. Project known fields only; never print raw records or errors.
import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const num = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
const label = (s) => (typeof s === "string" && /^[\w./:~-]{1,160}$/.test(s) ? s : "unknown");
const [home, id, ...extra] = process.argv.slice(2);
if (!home || !uuid.test(id ?? "") || extra.length) {
  console.error("Usage: node scripts/session-trace.mjs <data-home> <session-uuid>");
  process.exit(2);
}
async function scan(file, visit) {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let malformed = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      malformed++;
      continue;
    }
    if (!entry || typeof entry !== "object") {
      malformed++;
      continue;
    }
    visit(entry);
  }
  return malformed;
}
async function trace() {
  const dir = join(home, "sessions", id);
  const names = await readdir(dir);
  const file = names.find((n) => n.endsWith(`_${id}.jsonl`));
  const turns = [],
    settles = [],
    warnings = [];
  const childReads = new Map(),
    pendingReads = new Map();
  // A handle such as session-1 names a child; the session's handles.json keeps which.
  let handles = {};
  try {
    handles = Object.fromEntries(
      Object.entries(JSON.parse(await readFile(join(dir, "handles.json"), "utf8")).names).map(([child, handle]) => [handle, child]),
    );
  } catch {
    /* None given yet. */
  }
  // The child a call looked at: pispark_look with its handle, or (older transcripts) pispark_session read with its id.
  const looked = (c) =>
    c.name === "pispark_look"
      ? handles[c.arguments?.id]
      : c.name === "pispark_session" && c.arguments?.action === "read"
        ? c.arguments.id
        : undefined;
  let wake, turn;
  const newTurn = (trigger) => {
    turn = { turn: turns.length + 1, trigger, responses: [], results: [] };
    turns.push(turn);
  };
  if (!file) warnings.push("No saved transcript.");
  else if (
    await scan(join(dir, file), (e) => {
      if (e.type === "custom" && e.customType === "pispark:woken") wake = e.data?.source;
      const m = e.message;
      if (!m) return;
      if (m.role === "user") {
        newTurn(["session", "process", "schedule"].includes(wake?.kind) ? wake.kind : "unmarked");
        if (wake?.kind === "session" && childReads.has(wake.id)) turn.previousChildReadTurn = childReads.get(wake.id);
        wake = undefined;
      }
      if (m.role !== "assistant" && m.role !== "toolResult") return;
      if (!turn) newTurn("unknown");
      const content = Array.isArray(m.content) ? m.content : [];
      if (m.role === "assistant") {
        const calls = content.filter((c) => c?.type === "toolCall");
        turn.responses.push({
          provider: label(m.provider),
          model: label(m.model),
          fresh: num(m.usage?.input),
          cached: num(m.usage?.cacheRead),
          cacheWrite: num(m.usage?.cacheWrite),
          output: num(m.usage?.output),
          toolCalls: calls.length,
        });
        for (const c of calls) if (uuid.test(looked(c) ?? "")) pendingReads.set(c.id, looked(c));
      } else {
        turn.results.push({
          tool: label(m.toolName),
          textChars: content.reduce((n, c) => n + (typeof c?.text === "string" ? c.text.length : 0), 0),
        });
        if (pendingReads.has(m.toolCallId) && !m.isError) childReads.set(pendingReads.get(m.toolCallId), turn.turn);
        pendingReads.delete(m.toolCallId);
      }
    })
  )
    warnings.push("Some transcript records were unreadable.");
  let processes = null;
  if (names.includes("processes.json")) {
    const rows = JSON.parse(await readFile(join(dir, "processes.json"), "utf8")).processes;
    processes = rows.map((p) => ({
      state: ["running", "exited", "stopped", "failed"].includes(p.state) ? p.state : "unknown",
      exitCode: Number.isInteger(p.exitCode) ? p.exitCode : null,
    }));
  }
  try {
    if (
      await scan(join(home, "logs", "host.jsonl"), (e) => {
        if (e.sessionId === id && e.event === "session.settle")
          settles.push({
            outcome: ["completed", "failed", "cancelled"].includes(e.outcome) ? e.outcome : "unknown",
            durationMs: num(e.durationMs),
          });
      })
    )
      warnings.push("Some host records were unreadable.");
  } catch {
    warnings.push("Current host log unavailable.");
  }
  return {
    scope: "Direct session, transcript entry order; assistant usage only. Settles from current host log, not matched by position.",
    turns,
    processes,
    settles,
    warnings,
  };
}
try {
  console.log(JSON.stringify(await trace(), null, 2));
} catch {
  console.error("Session trace unavailable: check the data home, session ID and readable records.");
  process.exitCode = 1;
}
