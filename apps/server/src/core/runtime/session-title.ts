import { sessionTitle } from "../../contract/session-title.js";
import { RuntimeError } from "./errors.js";

/** The built-in extension's title tool; no agent extension may register the same name. */
export const TITLE_TOOL = "pispark_set_title";

/** Tool input is bounded before normalization; titles never enter operational errors. */
export function toolSessionTitle(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096)
    throw new RuntimeError("invalid-input");
  const title = sessionTitle(value);
  if (!title) throw new RuntimeError("invalid-input");
  return title;
}
