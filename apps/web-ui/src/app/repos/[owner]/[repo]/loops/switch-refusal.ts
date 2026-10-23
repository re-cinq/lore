import type { ApiResult } from "@/lib/api/result";

/** A refused switch in words a person can act on: the two-key ceremony's own codes get a sentence, anything else its message. */
export function refusalReason(
  result: Exclude<ApiResult<unknown>, { status: "ok" }>,
): string {
  if (result.status === "unconfigured") {
    return "The web UI has no Lore API configured.";
  }
  const body = (result.body ?? {}) as { error?: string; detail?: string };

  if (body.error === "two_key_required") {
    return "Switching auto merge on is two-key: name a pull request labelled dark-factory-approval and approved by a code owner of CLAUDE.md.";
  }

  return body.detail ?? result.message;
}
