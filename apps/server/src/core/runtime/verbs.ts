import { VERBS, type Verb } from "../../contract/verbs.js";

const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const optional = (value: unknown, max: number) => value === undefined || text(value, max);
const seconds = (value: unknown, max: number) => value === undefined || (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max);
const one = (value: unknown, of: readonly string[]) => value === undefined || of.includes(value as string);
/** A regular expression an agent wrote, or undefined when it is not one. */
export function pattern(source: string): RegExp | undefined {
  try {
    return new RegExp(source, "i");
  } catch {
    return undefined;
  }
}
const expression = (value: unknown) => value === undefined || (text(value, 200) && !!pattern(value as string));

/** Whether a request is one of the ten verbs, well formed. Whoever sent it (a tool, an extension) is checked the same way. */
export function validVerb(value: unknown): value is Verb {
  const r = value as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object" || !VERBS.includes(r.verb as Verb["verb"])) return false;
  switch (r.verb as Verb["verb"]) {
    case "start_session":
      return text(r.brief, 64 * 1024) && optional(r.title, 4096) && optional(r.agent, 64);
    case "start_process":
      return text(r.command, 8192) && optional(r.title, 120) && optional(r.folder, 4096) && seconds(r.stop_after_seconds, 7 * 86_400) && expression(r.raise_on);
    case "schedule":
      return (
        text(r.prompt, 8192) &&
        optional(r.cron, 100) &&
        optional(r.at, 40) &&
        (r.in_minutes === undefined || (Number.isInteger(r.in_minutes) && (r.in_minutes as number) >= 1 && (r.in_minutes as number) <= 525_600)) &&
        [r.cron, r.in_minutes, r.at].filter((each) => each !== undefined).length === 1 &&
        one(r.run, ["here", "new"])
      );
    case "send":
      // Words for a session, or a new pattern for a process ("" clears it): one of the two.
      return text(r.id, 64) && (r.text === undefined) !== (r.raise_on === undefined) && optional(r.text, 64 * 1024) && (r.raise_on === "" || expression(r.raise_on)) && one(r.when, ["now", "after"]);
    case "wait":
      return (
        (r.ids === undefined || (Array.isArray(r.ids) && r.ids.length > 0 && r.ids.length <= 50 && r.ids.every((id) => text(id, 64)))) &&
        one(r.for, ["all", "any"]) &&
        expression(r.until) &&
        seconds(r.seconds, 7 * 86_400)
      );
    case "look":
      return optional(r.id, 64) && (r.find === undefined || (text(r.find, 200) && !/[\r\n]/.test(r.find as string)));
    case "stop":
      return text(r.id, 64);
    case "raise":
    case "note":
      return text(r.text, 64 * 1024);
    case "self":
      return r.action === "inspect" || r.action === "reload";
    default:
      return false;
  }
}

/** Result data an extension set: plain JSON, at most 64 KiB. */
export function validResultData(value: unknown): boolean {
  if (value === undefined) return false;
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" && Buffer.byteLength(json, "utf8") <= 64 * 1024;
  } catch {
    return false;
  }
}
