export type ModelVendor = "anthropic" | "google" | "unknown";

const VENDOR_PREFIXES: ReadonlyArray<[string, ModelVendor]> = [
  ["claude-", "anthropic"],
  ["gemini-", "google"],
];

/** The vendor behind a model id; an inherited (null) or unrecognised model is unknown. */
export function modelVendor(model: string | null): ModelVendor {
  const match = VENDOR_PREFIXES.find(([prefix]) => model?.startsWith(prefix));

  return match ? match[1] : "unknown";
}
