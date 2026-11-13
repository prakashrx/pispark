import assert from "node:assert/strict";
import { test } from "node:test";
import { describeSchedule, nextRun, parseCron } from "../src/contract/cron.js";

const local = (text: string) => new Date(text); // No zone: the server's local time, as cron is.
const next = (cron: string, after: string) => nextRun(parseCron(cron)!, local(after))?.getTime();

test("cron: the five fields, ranges, steps and lists; anything else is refused", () => {
  for (const good of ["* * * * *", "0 9 * * 1-5", "*/15 * * * *", "0 */2 * * *", "30 7 1,15 * *", "0 0 * * 7", "5/20 * * * *"])
    assert.ok(parseCron(good), good);
  for (const bad of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "*/0 * * * *", "5-1 * * * *", "MON * * * *", "@daily", "0 9 * * L"])
    assert.equal(parseCron(bad), undefined, bad);
  assert.deepEqual([...parseCron("0 0 * * 7")!.weekdays], [0]);
});

test("cron: the next run, in local time", () => {
  assert.equal(next("0 9 * * *", "2026-11-13T08:59:59"), local("2026-11-13T09:00").getTime());
  assert.equal(next("0 9 * * *", "2026-11-13T09:00:00"), local("2026-11-14T09:00").getTime());
  // Friday 13 Nov 2026 → the next weekday is Monday.
  assert.equal(next("0 9 * * 1-5", "2026-11-13T10:00"), local("2026-11-16T09:00").getTime());
  assert.equal(next("*/15 * * * *", "2026-11-13T10:07"), local("2026-11-13T10:15").getTime());
  assert.equal(next("0 0 1 1 *", "2026-11-13T10:00"), local("2027-01-01T00:00").getTime());
  // Both day fields given: either one matches, as in classic cron.
  assert.equal(next("0 12 1 * 1", "2026-11-13T13:00"), local("2026-11-16T12:00").getTime());
  // A day that never comes.
  assert.equal(next("0 0 30 2 *", "2026-11-13T10:00"), undefined);
});

test("cron: how a schedule reads", () => {
  const now = local("2026-11-13T08:00");
  assert.equal(describeSchedule({ cron: "0 9 * * *" }), "Every day at 9:00 am");
  assert.equal(describeSchedule({ cron: "30 17 * * 1-5" }), "Every weekday at 5:30 pm");
  assert.equal(describeSchedule({ cron: "0 17 * * 5" }), "Every Friday at 5:00 pm");
  assert.equal(describeSchedule({ cron: "0 10 * * 0,6" }), "Every weekend at 10:00 am");
  assert.equal(describeSchedule({ cron: "0 8 * * 1,3" }), "Mon, Wed at 8:00 am");
  assert.equal(describeSchedule({ cron: "*/30 * * * *" }), "Every 30 minutes");
  assert.equal(describeSchedule({ cron: "0 */2 * * *" }), "Every 2 hours");
  assert.equal(describeSchedule({ cron: "15 * * * *" }), "Every hour at :15");
  assert.equal(describeSchedule({ cron: "0 9 1 * *" }), "Cron 0 9 1 * *");
  assert.equal(describeSchedule({ at: local("2026-11-13T15:30").toISOString() }, now), "Once, Fri 13 Nov, 3:30 pm");
  assert.equal(describeSchedule({ at: local("2027-01-04T00:05").toISOString() }, now), "Once, Mon 4 Jan 2027, 12:05 am");
});
