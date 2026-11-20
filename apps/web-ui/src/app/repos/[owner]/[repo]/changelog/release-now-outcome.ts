import type { ReleaseStarted } from "@/lib/api/changelog";
import type { ApiResult } from "@/lib/api/result";

export type ReleaseNowResult =
  { ok: true; runId: string; joined: boolean } | { ok: false; said: string };

/** Starts the release line for the repository and says what came of it. */
export type ReleaseNow = () => Promise<ReleaseNowResult>;

const REFUSALS: Record<number, string> = {
  409: "this repository is another repository's public mirror, and that one is released instead",
  503: "Lore has no floor or database to run it on right now. Try again in a minute",
};

/** A refusal or failure as one plain sentence; a start as the run to follow. */
export function releaseNowOutcome(
  result: ApiResult<ReleaseStarted>,
): ReleaseNowResult {
  if (result.status === "ok") {
    return { ok: true, ...result.data };
  }

  return {
    ok: false,
    said: `Could not start the release: ${reasonOf(result)}.`,
  };
}

function reasonOf(
  result: Exclude<ApiResult<ReleaseStarted>, { status: "ok" }>,
) {
  if (result.status === "unconfigured") {
    return "Lore API unconfigured";
  }

  return REFUSALS[result.code ?? 0] ?? result.message;
}
