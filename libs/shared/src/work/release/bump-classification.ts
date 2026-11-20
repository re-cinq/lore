import { z } from "zod";
import type { Bump } from "./next-version.js";

/** The file the release agent writes: exactly `{"bump":"major"|"minor"|"patch"}`, and no default when it is anything else. */

const BumpClassificationSchema = z.strictObject({
  bump: z.enum(["major", "minor", "patch"]),
});

export type BumpClassification =
  { ok: true; bump: Bump } | { ok: false; reason: string };

export function parseBumpClassification(text: string): BumpClassification {
  const parsed = parseJson(text);

  if (!parsed.ok) {
    return { ok: false, reason: "the classification is not valid JSON" };
  }
  const classification = BumpClassificationSchema.safeParse(parsed.value);

  return classification.success
    ? { ok: true, bump: classification.data.bump }
    : { ok: false, reason: "bump must be major, minor or patch" };
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
