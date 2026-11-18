/** PiSpark's built-in title tool: housekeeping, which the conversation doesn't show as work. */
export const TITLE_TOOL = "pispark_set_title";
/** A session title: one printable line of at most 80 code points. User content: never log it. */
export function sessionTitle(input: string): string {
  const line =
    input
      .split(/\r\n|[\n\r\u2028\u2029]/u)
      .map((line) => line.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim())
      .find(Boolean) ?? "";
  const points = Array.from(line);
  return points.length > 80 ? points.slice(0, 79).join("") + "…" : line;
}
export function validSessionTitle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !!value &&
    Array.from(value).length <= 80 &&
    sessionTitle(value) === value
  );
}
