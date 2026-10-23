// Turning auto merge on and off (specs/protected-branch-merge), shared by the settings save and the Loops tab's switch so neither is a way around the other.
import type { Request } from "@hapi/hapi";
import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import { isAppConfigured } from "../../../outbound/github-client.js";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  disarmLorePulls,
  missingPrerequisites,
} from "../../../work/repo/auto-merge-approver.js";
import { checkApproval, type ApprovalOutcome } from "../two-key.js";

/** The gate a write that names `approver` must pass: switching to lore-reviewer is gated, anything else is not. */
export async function approverGate(
  request: Request,
  repo: string,
  approver: string | undefined,
): Promise<{ ok: true } | ApprovalOutcome> {
  return approver === "lore-reviewer"
    ? autoMergeGate(request, repo)
    : { ok: true };
}

/** Switching to lore-reviewer needs the App, a protecting ruleset on the default branch, and the two-key ceremony. */
export async function autoMergeGate(
  request: Request,
  repo: string,
): Promise<{ ok: true } | ApprovalOutcome> {
  const missing = await missingPrerequisitesOf(repo);

  if (missing.length > 0) {
    return missingPrerequisitesError(missing);
  }

  return checkApproval(
    request,
    repo,
    ["auto_merge.approver"],
    "Turning auto_merge.approver on is two-key",
  );
}

async function missingPrerequisitesOf(repo: string): Promise<string[]> {
  const { pulls, repo: files } = await projectFor(repo);

  return missingPrerequisites({
    appInstalled: isAppConfigured(),
    defaultBranch: () => files.defaultBranch(),
    getBranchRule: (branch) => pulls.getBranchRule(branch),
  });
}

function missingPrerequisitesError(missing: string[]): ApprovalOutcome {
  return {
    ok: false,
    code: 403,
    body: {
      error: `Cannot enable lore-reviewer. Missing: ${missing.join(", ")}`,
      code: "missing_prerequisites",
      missing,
    },
  };
}

/** Switching auto merge off takes back the auto-merge Lore armed on its own open pull requests; a PR that cannot be disarmed is logged, never a failed save. */
export async function disarmAutoMerge(repo: string): Promise<void> {
  const { pulls, audit } = await projectFor(repo);
  const failed = await disarmLorePulls({
    pulls,
    audit,
    appLogin: await loreAppLogin(),
  });

  if (failed.length > 0) {
    console.error(
      `[settings] could not disarm auto-merge on ${repo} PRs ${failed.join(", ")}`,
    );
  }
}
