/**
 * Five-field cron (minute hour day-of-month month day-of-week) in the server's local time, and how
 * schedules read to a person. Numbers, `*`, ranges, steps and lists; day-of-week 0–7 (0 and 7 are
 * Sunday). As in classic cron, when both day fields are restricted a day matching either one counts.
 * No names, `L`, `W`, `#` or seconds.
 */
export interface Cron {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  /** Whether day-of-month and day-of-week were given (not `*`). */
  dayRestricted: boolean;
  weekdayRestricted: boolean;
}

const FIELDS = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const;

function field(text: string, [low, high]: readonly [number, number]): Set<number> | undefined {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^(\*|(\d{1,2})(?:-(\d{1,2}))?)(?:\/(\d{1,2}))?$/.exec(part);
    if (!match) return undefined;
    const step = match[4] === undefined ? 1 : Number(match[4]);
    let from = low;
    let to = high;
    if (match[1] !== "*") {
      from = Number(match[2]);
      to = match[3] === undefined ? (match[4] === undefined ? from : high) : Number(match[3]);
    }
    if (step < 1 || from < low || to > high || from > to) return undefined;
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values.size ? values : undefined;
}

/** The parsed cron, or undefined when it is not one this parser takes. */
export function parseCron(text: string): Cron | undefined {
  if (typeof text !== "string" || text.length > 100) return undefined;
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 5) return undefined;
  const sets = parts.map((part, index) => field(part, FIELDS[index]!));
  if (sets.some((set) => !set)) return undefined;
  const [minutes, hours, days, months, weekdays] = sets as Set<number>[];
  if (weekdays!.delete(7)) weekdays!.add(0);
  return {
    minutes: minutes!,
    hours: hours!,
    days: days!,
    months: months!,
    weekdays: weekdays!,
    dayRestricted: parts[2] !== "*",
    weekdayRestricted: parts[4] !== "*",
  };
}

function dayMatches(cron: Cron, date: Date): boolean {
  const day = cron.days.has(date.getDate());
  const weekday = cron.weekdays.has(date.getDay());
  if (cron.dayRestricted && cron.weekdayRestricted) return day || weekday;
  return day && weekday;
}

/** The first time after `after` (to the minute, local time) the cron matches; undefined within ~4 years if never. */
export function nextRun(cron: Cron, after: Date): Date | undefined {
  const date = new Date(after.getTime());
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  const limit = after.getTime() + 4 * 366 * 86_400_000;
  while (date.getTime() <= limit) {
    if (!cron.months.has(date.getMonth() + 1)) {
      date.setMonth(date.getMonth() + 1, 1);
      date.setHours(0, 0, 0, 0);
    } else if (!dayMatches(cron, date)) {
      date.setDate(date.getDate() + 1);
      date.setHours(0, 0, 0, 0);
    } else if (!cron.hours.has(date.getHours())) {
      date.setHours(date.getHours() + 1, 0, 0, 0);
    } else if (!cron.minutes.has(date.getMinutes())) {
      date.setMinutes(date.getMinutes() + 1, 0, 0);
    } else return date;
  }
  return undefined;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9:00 am", "12:30 pm". */
export function clockTime(hour: number, minute: number): string {
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}
/** "Fri 13 Nov, 9:00 am"; the year only when it is not this year's. */
export function shortDate(date: Date, now = new Date()): string {
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${WEEKDAYS[date.getDay()]!.slice(0, 3)} ${date.getDate()} ${MONTHS[date.getMonth()]}${year}, ${clockTime(date.getHours(), date.getMinutes())}`;
}

const single = (set: Set<number>) => (set.size === 1 ? [...set][0]! : undefined);
const all = (set: Set<number>, low: number, high: number) => set.size === high - low + 1;

/** How a schedule reads: "Every weekday at 9:00 am", "Every 30 minutes", "Once, Fri 13 Nov, 3:30 pm". */
export function describeSchedule(when: { cron?: string; at?: string }, now = new Date()): string {
  if (when.at !== undefined) {
    const at = new Date(when.at);
    return Number.isNaN(at.getTime()) ? "Once" : `Once, ${shortDate(at, now)}`;
  }
  const text = when.cron?.trim() ?? "";
  const cron = parseCron(text);
  if (!cron) return `Cron ${text}`;
  const [minuteField, hourField] = text.split(/\s+/);
  const everyDay = !cron.dayRestricted && all(cron.months, 1, 12);
  const minute = single(cron.minutes);
  const hour = single(cron.hours);
  const step = (fieldText: string) => /^\*\/(\d+)$/.exec(fieldText ?? "")?.[1];
  if (everyDay && !cron.weekdayRestricted) {
    const minutes = step(minuteField!);
    if (minutes && all(cron.hours, 0, 23)) return Number(minutes) === 1 ? "Every minute" : `Every ${minutes} minutes`;
    if (minuteField === "*" && all(cron.hours, 0, 23)) return "Every minute";
    const hours = step(hourField!);
    if (minute !== undefined && hours) return Number(hours) === 1 ? `Every hour at :${String(minute).padStart(2, "0")}` : `Every ${hours} hours`;
    if (minute !== undefined && hourField === "*") return `Every hour at :${String(minute).padStart(2, "0")}`;
  }
  if (minute !== undefined && hour !== undefined && everyDay) {
    const at = clockTime(hour, minute);
    if (!cron.weekdayRestricted) return `Every day at ${at}`;
    const days = [...cron.weekdays].sort();
    if (days.join() === "1,2,3,4,5") return `Every weekday at ${at}`;
    if (days.join() === "0,6") return `Every weekend at ${at}`;
    if (days.length === 1) return `Every ${WEEKDAYS[days[0]!]} at ${at}`;
    return `${days.map((day) => WEEKDAYS[day]!.slice(0, 3)).join(", ")} at ${at}`;
  }
  return `Cron ${text}`;
}
