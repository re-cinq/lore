/** Which account a model's cost lands on; unknown models default to Anthropic to understate remaining balance safely. */

export type ModelVendor = "anthropic" | "gemini" | "openai" | "local";

/** SQL LIKE patterns for non-Anthropic vendors; used directly in spend queries to prevent drift. */
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

/** The vendor billed for one model id; unknown ids and empty models read as anthropic. */
export function modelVendor(model: string): ModelVendor {
  const id = model.trim().toLowerCase();

  return PREFIXES.find(([prefix]) => id.startsWith(prefix))?.[1] ?? "anthropic";
}
