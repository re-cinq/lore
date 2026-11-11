// Two-key CODEOWNERS-approval ceremony for agent-definition image writes (ADR-025).

import type { Request } from "@hapi/hapi";
import { verifyApproval, TwoKeyError } from "../../work/two-key/approval-pr.js";
import { getOctokit } from "../../outbound/github-client.js";

export interface ApprovalEvidence {
  prRef: string;
  approver: string;
  prUrl: string;
}

export type ApprovalOutcome =
  | { ok: true; evidence: ApprovalEvidence }
  | { ok: false; code: 403 | 503; body: object };

export async function checkApproval(
  request: Request,
  repo: string,
  fieldPaths: string[],
  detail: string,
): Promise<ApprovalOutcome> {
  const prRef = request.headers["x-lore-approval-pr"];

  if (typeof prRef !== "string" || !prRef) {
    return twoKeyRequired(fieldPaths, detail);
  }

  try {
    const octokit = await getOctokit();
    const evidence = await verifyApproval({ octokit, prRef, targetRepo: repo });

    return { ok: true, evidence };
  } catch (err) {
    return approvalFailure(err);
  }
}

/** The second key was never presented: no approval-PR header on a write that needs one. */
function twoKeyRequired(fieldPaths: string[], detail: string): ApprovalOutcome {
  return {
    ok: false,
    code: 403,
    body: { error: "two_key_required", field_paths: fieldPaths, detail },
  };
}

/** Why the ceremony did not pass. A `TwoKeyError` with code `github_api` means GitHub itself was unreachable (503, retryable); every other `TwoKeyError` is the CEREMONY refusing (403, the approver must act); anything else is also a GitHub outage (503). */
function approvalFailure(err: unknown): ApprovalOutcome {
  if (err instanceof TwoKeyError && err.code !== "github_api") {
    return {
      ok: false,
      code: 403,
      body: {
        error: "codeowners_check_failed",
        code: err.code,
        detail: err.message,
      },
    };
  }
  console.error("[two-key] verify failed:", err);

  return { ok: false, code: 503, body: { error: "github_api_unavailable" } };
}
