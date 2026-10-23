import type { ApiResult } from "@/lib/api/result";

/** A refused switch in words a person can act on: what lore-api said, or that the web UI cannot reach it. */
export function refusalReason(
  result: Exclude<ApiResult<unknown>, { status: "ok" }>,
): string {
  if (result.status === "unconfigured") {
    return "The web UI has no Lore API configured.";
  }
  const body = (result.body ?? {}) as { detail?: string };

  return body.detail ?? result.message;
}
