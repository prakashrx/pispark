import { clockTime, parseCron, shortDate } from "../../../../server/src/contract/cron";
import type { Schedule, ScheduleWhen } from "../../../../server/src/contract/schedule-protocol";
import type { WakeRecord } from "../../../../server/src/contract/wake-protocol";
import { commandError } from "../workspace/session-presentation";

/** The plain choices the form offers; each writes a cron (or, once, a time). */
export type Repeat = "once" | "day" | "weekdays" | "week" | "hours" | "minutes" | "cron";
export interface WhenChoice {
  repeat: Repeat;
  /** "HH:MM", for once, every day, weekdays and every week. */
  time: string;
  /** "YYYY-MM-DD", for once. */
  date: string;
  /** 0 (Sunday) to 6, for every week. */
  weekday: string;
  /** Every this many hours or minutes. */
  every: string;
  cron: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** What the form shows for a schedule; one it cannot say in plain choices is shown as cron. */
export function choiceOf(when: ScheduleWhen | undefined, now = new Date()): WhenChoice {
  const inAnHour = new Date(now.getTime() + 3_600_000);
  const base: WhenChoice = { repeat: "day", time: "09:00", date: localDate(inAnHour), weekday: "1", every: "2", cron: "0 9 * * *" };
  if (!when) return base;
  if (when.at !== undefined) {
    const at = new Date(when.at);
    return { ...base, repeat: "once", date: localDate(at), time: localTime(at) };
  }
  const cron = when.cron ?? "";
  const parts = cron.split(" ");
  const choice = { ...base, cron };
  const [minute, hour, day, month, weekday] = parts;
  if (parts.length !== 5 || day !== "*" || month !== "*") return { ...choice, repeat: "cron" };
  const step = (field: string) => /^\*\/(\d+)$/.exec(field)?.[1];
  if (step(minute!) && hour === "*" && weekday === "*") return { ...choice, repeat: "minutes", every: step(minute!)! };
  if (/^\d+$/.test(minute!) && Number(minute) === 0 && (step(hour!) || hour === "*") && weekday === "*")
    return { ...choice, repeat: "hours", every: step(hour!) ?? "1" };
  if (/^\d+$/.test(minute!) && /^\d+$/.test(hour!)) {
    const time = `${pad(Number(hour))}:${pad(Number(minute))}`;
    if (weekday === "*") return { ...choice, repeat: "day", time };
    if (weekday === "1-5") return { ...choice, repeat: "weekdays", time };
    if (/^[0-6]$/.test(weekday!)) return { ...choice, repeat: "week", time, weekday: weekday! };
  }
  return { ...choice, repeat: "cron" };
}

/** The schedule's time from the form, or why it is not one. */
export function whenOf(choice: WhenChoice, now = new Date()): ScheduleWhen | { error: string } {
  const time = /^(\d{2}):(\d{2})$/.exec(choice.time);
  const [hour, minute] = time ? [Number(time[1]), Number(time[2])] : [NaN, NaN];
  const needsTime = ["once", "day", "weekdays", "week"].includes(choice.repeat);
  if (needsTime && (!time || hour > 23 || minute > 59)) return { error: "Enter a time." };
  const every = Number(choice.every);
  switch (choice.repeat) {
    case "once": {
      const at = new Date(`${choice.date}T${choice.time}`);
      if (Number.isNaN(at.getTime())) return { error: "Enter a date and time." };
      if (at.getTime() <= now.getTime()) return { error: "Choose a time in the future." };
      return { at: at.toISOString() };
    }
    case "day":
      return { cron: `${minute} ${hour} * * *` };
    case "weekdays":
      return { cron: `${minute} ${hour} * * 1-5` };
    case "week":
      return { cron: `${minute} ${hour} * * ${choice.weekday}` };
    case "hours":
      if (!Number.isInteger(every) || every < 1 || every > 23) return { error: "Enter a number of hours from 1 to 23." };
      return { cron: every === 1 ? "0 * * * *" : `0 */${every} * * *` };
    case "minutes":
      if (!Number.isInteger(every) || every < 1 || every > 59) return { error: "Enter a number of minutes from 1 to 59." };
      return { cron: `*/${every} * * * *` };
    case "cron":
      return parseCron(choice.cron) ? { cron: choice.cron.trim().replace(/\s+/g, " ") } : { error: "That isn’t a cron this server understands." };
  }
}

/** "Next Mon 16 Nov, 9:00 am", or why it will not run. */
export function nextText(schedule: Schedule, paused: boolean, now = new Date()): string {
  if (schedule.held === "archived") return "Paused: chat archived";
  if (!schedule.on) return "Off";
  if (paused) return "Paused";
  if (schedule.waiting) return "Waiting for the chat to be free";
  return schedule.next ? `Next ${shortDate(new Date(schedule.next), now)}` : "No next run";
}

/** What happened to a run, in words that do not depend on color. */
export function runText(run: WakeRecord, now = new Date()): string {
  const late = Math.round((new Date(run.at).getTime() - new Date(run.due).getTime()) / 60_000);
  const due = new Date(run.due);
  switch (run.outcome) {
    case "ran":
      if (run.manual) return "Ran now, by hand";
      if (run.reason === "busy") return late >= 1 ? `Waited ${late} min for the chat, then ran` : "Waited for the chat, then ran";
      if (run.reason === "off") return `Ran late: PiSpark wasn’t running at ${clockTime(due.getHours(), due.getMinutes())}`;
      return "Ran";
    case "failed":
      return `Failed: ${commandError(run.error ?? "execution")}`;
    case "cancelled":
      return "Stopped before it finished";
    case "missed":
      if (run.reason === "paused") return "Missed: unattended runs were paused";
      if (run.reason === "full") return "Missed: too many were already waiting";
      return `Missed: PiSpark wasn’t running (${shortDate(due, now)})`;
  }
}
export const runFailed = (run: WakeRecord) => run.outcome === "failed";
