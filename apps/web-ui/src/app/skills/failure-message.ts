import type { ApiResult } from "@/lib/api/result";

type FailedResult = Exclude<ApiResult, { status: "ok" }>;

export function failureMessage(result: FailedResult): string {
  return result.status === "unconfigured"
    ? "the web UI has no LORE_API_URL set or no signed-in session."
    : result.message;
}
