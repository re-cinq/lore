export type ModelVendor = "anthropic" | "google" | "openai" | "unknown";

const VENDOR_PREFIXES: ReadonlyArray<[string, ModelVendor]> = [
  ["claude-", "anthropic"],
  ["gemini-", "google"],
  ["gpt-", "openai"],
  ["o1", "openai"],
  ["o3", "openai"],
  ["o4", "openai"],
  ["codex", "openai"],
];

/** The vendor behind a model id, for display; an inherited (null) or unrecognised model is unknown. Unlike the billing classifier in lore-shared, nothing here defaults to Anthropic. */
export function modelVendor(model: string | null): ModelVendor {
  const match = VENDOR_PREFIXES.find(([prefix]) => model?.startsWith(prefix));

  return match ? match[1] : "unknown";
}
