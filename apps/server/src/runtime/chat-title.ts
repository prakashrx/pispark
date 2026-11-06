import { RuntimeError } from "./errors.js";

/** User content: never include titles in diagnostic logs. */
export function chatTitle(input: string): string {
  const line =
    input
      .split(/\r\n|[\n\r\u2028\u2029]/u)
      .map((line) => line.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim())
      .find(Boolean) ?? "";
  const points = Array.from(line);
  return points.length > 80 ? points.slice(0, 79).join("") + "…" : line;
}
export function validChatTitle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !!value &&
    Array.from(value).length <= 80 &&
    chatTitle(value) === value
  );
}

/** Tool input is bounded before normalization; titles never enter operational errors. */
export function toolChatTitle(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096)
    throw new RuntimeError("invalid-input");
  const title = chatTitle(value);
  if (!title) throw new RuntimeError("invalid-input");
  return title;
}
