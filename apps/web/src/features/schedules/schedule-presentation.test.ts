import { expect, test } from "vitest";
import { choiceOf, nextText, runText, whenOf, type WhenChoice } from "./schedule-presentation";
import { buildTurns, wokenLabel } from "../workspace/chat-turns";
import type { Schedule } from "../../../../server/src/contract/schedule-protocol";
import { WOKEN_ENTRY } from "../../../../server/src/contract/wake-protocol";

const now = new Date("2026-11-13T08:00");
const base: WhenChoice = { repeat: "day", time: "09:00", date: "2026-11-13", weekday: "1", every: "2", cron: "" };

test("the form's plain choices write cron, and read it back", () => {
  expect(whenOf({ ...base, repeat: "day" }, now)).toEqual({ cron: "0 9 * * *" });
  expect(whenOf({ ...base, repeat: "weekdays", time: "17:30" }, now)).toEqual({ cron: "30 17 * * 1-5" });
  expect(whenOf({ ...base, repeat: "week", weekday: "5" }, now)).toEqual({ cron: "0 9 * * 5" });
  expect(whenOf({ ...base, repeat: "hours", every: "1" }, now)).toEqual({ cron: "0 * * * *" });
  expect(whenOf({ ...base, repeat: "hours", every: "3" }, now)).toEqual({ cron: "0 */3 * * *" });
  expect(whenOf({ ...base, repeat: "minutes", every: "30" }, now)).toEqual({ cron: "*/30 * * * *" });
  expect(whenOf({ ...base, repeat: "cron", cron: " 0  9 1 * * " }, now)).toEqual({ cron: "0 9 1 * *" });
  expect(whenOf({ ...base, repeat: "once", time: "15:30" }, now)).toEqual({ at: new Date("2026-11-13T15:30").toISOString() });
  for (const bad of [
    { ...base, repeat: "once" as const, time: "07:00" },
    { ...base, repeat: "minutes" as const, every: "0" },
    { ...base, repeat: "hours" as const, every: "24" },
    { ...base, repeat: "cron" as const, cron: "daily" },
    { ...base, time: "" },
  ])
    expect(whenOf(bad, now)).toHaveProperty("error");

  for (const cron of ["0 9 * * *", "30 17 * * 1-5", "0 9 * * 5", "0 */3 * * *", "*/30 * * * *"])
    expect(whenOf(choiceOf({ cron }, now), now)).toEqual({ cron });
  expect(choiceOf({ cron: "0 9 1 * *" }, now).repeat).toBe("cron");
  expect(choiceOf({ at: new Date("2026-11-14T07:15").toISOString() }, now)).toMatchObject({ repeat: "once", date: "2026-11-14", time: "07:15" });
});

test("what a run did and when the next one is, in words", () => {
  const due = new Date("2026-11-13T09:00").toISOString();
  const at = (minutes: number) => new Date(new Date(due).getTime() + minutes * 60_000).toISOString();
  expect(runText({ due, at: at(0), outcome: "ran" }, now)).toBe("Ran");
  expect(runText({ due, at: at(4), outcome: "ran", reason: "busy" }, now)).toBe("Waited 4 min for the chat, then ran");
  expect(runText({ due, at: at(120), outcome: "ran", reason: "off" }, now)).toBe("Ran late: PiSpark wasn’t running at 9:00 am");
  expect(runText({ due, at: at(0), outcome: "ran", manual: true }, now)).toBe("Ran now, by hand");
  expect(runText({ due, at: at(0), outcome: "missed", reason: "paused" }, now)).toBe("Missed: unattended runs were paused");
  expect(runText({ due, at: at(0), outcome: "missed", reason: "full" }, now)).toBe("Missed: too many were already waiting");
  expect(runText({ due, at: at(0), outcome: "limit" }, now)).toBe("Skipped: the daily limit was reached");
  expect(runText({ due, at: at(0), outcome: "failed", error: "busy" }, now)).toMatch(/^Failed: /);

  const schedule = { on: true, next: new Date("2026-11-16T09:00").toISOString() } as Schedule;
  expect(nextText(schedule, false, now)).toBe("Next Mon 16 Nov, 9:00 am");
  expect(nextText(schedule, true, now)).toBe("Paused");
  expect(nextText({ ...schedule, on: false }, false, now)).toBe("Off");
  expect(nextText({ ...schedule, held: "archived" }, false, now)).toBe("Paused: chat archived");
  expect(nextText({ ...schedule, waiting: true }, false, now)).toBe("Waiting for the chat to be free");
});

test("a woken turn's message is labelled with its source in the conversation", () => {
  const due = new Date("2026-11-13T09:00").toISOString();
  const source = { kind: "schedule", id: "s", label: "Every day at 9:00 am · Fri 13 Nov" };
  expect(wokenLabel({ source, due })).toBe("Scheduled · Every day at 9:00 am · Fri 13 Nov");
  // A source this client does not know still says the turn was not typed.
  expect(wokenLabel({ source: { kind: "later", id: "x", label: "From elsewhere" }, due })).toBe("Woken · From elsewhere");
  expect(wokenLabel(undefined)).toBe("Woken");
  const turns = buildTurns(
    [
      { key: "u1", role: "user", parts: [{ type: "text", text: "typed" }] },
      { key: "m", role: "entry", customType: WOKEN_ENTRY, parts: [], details: { source, due } },
      { key: "u2", role: "user", parts: [{ type: "text", text: "sent by the schedule" }] },
    ],
    { running: false },
  );
  expect(turns.map((turn) => turn.woken)).toEqual([undefined, expect.stringMatching(/^Scheduled · Every day at 9:00 am/)]);
  expect(turns.flatMap((turn) => turn.segments)).toEqual([]);
});
