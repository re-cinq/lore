import type { StationRun } from "../models/station-run.js";
import type { RunCredentialClaims } from "./run-credential.js";

/** What the broker knows when a run asks for a git credential: the verified claims, the station run they name, and the repo git wants. */
export interface GitCredentialRequest {
  claims: RunCredentialClaims;
  stationRun: Pick<StationRun, "stationRunId" | "outcome">;
  repo: string;
}

export type GitCredentialDecision =
  | { grant: true; repo: string }
  | { grant: false; reason: "run-closed" | "repo-mismatch" };

export function decideGitCredential(
  request: GitCredentialRequest,
): GitCredentialDecision {
  if (request.stationRun.outcome !== null) {
    return { grant: false, reason: "run-closed" };
  }

  if (request.repo !== request.claims.repo) {
    return { grant: false, reason: "repo-mismatch" };
  }

  return { grant: true, repo: request.repo };
}
