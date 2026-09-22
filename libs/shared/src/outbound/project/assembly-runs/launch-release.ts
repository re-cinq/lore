// What a cluster-agent's hand-back of an unlaunchable visit becomes (#2006): the error's class decides whether any retry could launch it, and the bound caps the ones that might.

import {
  classifyError,
  isPermanentFailure,
} from "../../../lib/error-classify.js";
import type { StationRunRelease } from "./assembly-runs-port.js";

const DEFAULT_LAUNCH_ATTEMPTS = 3;

export function launchReleaseOf(
  reason: string,
  maxAttempts: number,
): StationRunRelease {
  const { category } = classifyError(reason);

  return {
    reason,
    failureClass: category,
    permanent: isPermanentFailure(category),
    maxAttempts,
  };
}

/** How many hand-backs a visit may absorb before it fails; `LORE_STATION_LAUNCH_ATTEMPTS`, default 3. */
export function launchAttemptsFromEnv(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.LORE_STATION_LAUNCH_ATTEMPTS);

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_LAUNCH_ATTEMPTS;
}
