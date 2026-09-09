/** Pure helpers for the create-feature server action. */

import type { ApiResult } from "@/lib/api/result";

/** A form field's trimmed value, or empty when absent. */
export function trimmedFormField(formData: FormData, key: string): string {
  const raw = formData.get(key);

  return typeof raw === "string" ? raw.trim() : "";
}

/** The user-facing message for a failed `createFeature` call. */
export function createFeatureErrorMessage(
  result: Exclude<ApiResult<unknown>, { status: "ok" }>,
): string {
  return result.status === "unconfigured"
    ? "Feature API is not configured (LORE_API_URL / token)."
    : result.message;
}
