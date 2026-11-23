import type { Model, Api, ModelCost } from "@earendil-works/pi-ai";

/**
 * PiSpark's choices for Pi's compaction. Pi does the work (where to cut, the summary, the
 * transcript); PiSpark picks the moment, how much recent conversation stays word for word, and
 * what the summary must not lose.
 */

/** Pi's own default for the recent conversation kept word for word. */
const PI_KEEP_RECENT = 20_000;

/** The window that is worth filling: the model's, or the input tokens where its price rises. */
function usableWindow(window: number, cost?: ModelCost): number {
  return Math.min(window, ...(cost?.tiers ?? []).map((t) => t.inputTokensAbove));
}

/**
 * Tokens a session's context may reach before it is compacted between the person's messages: 70%
 * of the usable window. Pi's own threshold (the window less its reserve) stays the safety net
 * while a run works.
 */
export function contextBudget(window: number, cost?: ModelCost): number {
  return Math.floor(usableWindow(window, cost) * 0.7);
}

/** Recent conversation kept word for word: a fifth of the usable window, never less than Pi's default. */
export function keepRecentTokens(window: number, cost?: ModelCost): number {
  return Math.max(PI_KEEP_RECENT, Math.floor(usableWindow(window, cost) * 0.2));
}

/** Pi's per-model compaction settings for a catalog, keyed as Pi reads them. */
export function compactionOverrides(models: readonly Model<Api>[]): Record<string, { keepRecentTokens: number }> {
  return Object.fromEntries(models.map((m) => [`${m.provider}/${m.id}`, { keepRecentTokens: keepRecentTokens(m.contextWindow, m.cost) }]));
}

/** Added to Pi's summary prompt when PiSpark compacts, on top of Pi's goal, progress and decisions. */
export const SUMMARY_FOCUS =
  "Also keep the user's requests in their own words (the latest one exactly), approaches that were tried and rejected and why, and errors that are not resolved yet with their exact message.";
