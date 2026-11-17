/**
 * How much care a question asks for, read from its own words: Pi's `ctx.ui` questions carry no tone,
 * but "Dangerous command: rm -rf …" says it. Colour follows the tone; the word beside it says it too.
 */
export type QuestionTone = "info" | "warning" | "danger";

const DANGER = /\b(danger(ous)?|destructive|irreversible|permanent(ly)?|delete|deleting|rm\s+-r|force[- ]push|drop\s+(table|database)|wipe|erase)\b/i;
const WARNING = /\b(warning|caution|careful|risky|overwrite|replace|are you sure|cannot be undone|can't be undone|can’t be undone)\b/i;

export function questionTone(...texts: (string | undefined)[]): QuestionTone {
  const text = texts.filter(Boolean).join("\n");
  if (DANGER.test(text)) return "danger";
  if (WARNING.test(text)) return "warning";
  return "info";
}

/** The word that goes with the tone, so it never rests on colour alone. */
export const TONE_WORDS: Record<QuestionTone, string> = {
  info: "Needs you",
  warning: "Needs you · Check first",
  danger: "Needs you · Dangerous",
};
