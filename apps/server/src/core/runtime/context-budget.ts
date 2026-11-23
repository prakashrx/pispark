import type { ModelCost } from "@earendil-works/pi-ai";

/** The share of the usable window a session fills before it compacts between the person's messages. */
const SHARE = 0.7;

/**
 * Tokens a session's context may reach before it is compacted between the person's messages:
 * 70% of the usable window, which is the model's window or, when the price rises above a number
 * of input tokens, that number. Pi's own threshold (the window less its reserve) stays the safety
 * net while a run works.
 */
export function contextBudget(window: number, cost?: ModelCost): number {
  const tier = Math.min(...(cost?.tiers ?? []).map((t) => t.inputTokensAbove));
  return Math.floor(Math.min(window, tier) * SHARE);
}
