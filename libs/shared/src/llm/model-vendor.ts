/**
 * Which account a model's cost lands on, derived from the model id.
 *
 * `pipeline.llm_calls` records every call Lore prices, whoever bills it — so
 * a page that reports "spend against the Anthropic balance" has to separate
 * them, and since 2026-09-02 that is not academic: the review family runs on
 * Gemini, which bills Google.
 *
 * Deliberately asymmetric. {@link NON_ANTHROPIC_LIKE_PATTERNS} enumerates only
 * what is KNOWN to bill elsewhere, and everything else counts as Anthropic:
 * for a remaining-balance figure, mistaking someone else's spend for ours
 * understates what is left (visible, and alarming in the safe direction) while
 * the reverse silently reports money that is already gone.
 */

export type ModelVendor = "anthropic" | "gemini" | "openai" | "local";

/** SQL `LIKE` patterns for the vendors that do NOT bill the Anthropic account.
 *  One declaration: the spend queries pass this array straight to
 *  `NOT LIKE ALL($n)`, so the page and this classifier cannot drift. */
export const NON_ANTHROPIC_LIKE_PATTERNS = [
  "gemini%",
  "gpt%",
  "o1%",
  "o3%",
  "llama%",
  "mistral%",
  "qwen%",
] as const;

const PREFIXES: ReadonlyArray<[string, ModelVendor]> = [
  ["gemini", "gemini"],
  ["gpt", "openai"],
  ["o1", "openai"],
  ["o3", "openai"],
  ["llama", "local"],
  ["mistral", "local"],
  ["qwen", "local"],
];

/**
 * The vendor billed for one model id. An empty model (Anthropic's non-token
 * line — web search, code execution) and any unrecognized id read as
 * `anthropic`, for the reason above.
 */
export function modelVendor(model: string): ModelVendor {
  const id = model.trim().toLowerCase();

  return PREFIXES.find(([prefix]) => id.startsWith(prefix))?.[1] ?? "anthropic";
}
