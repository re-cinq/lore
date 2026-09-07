// Two-key CODEOWNERS-approval ceremony for dark-factory settings + agent-definition writes (ADR-016/025).

import type { Request } from "@hapi/hapi";
import {
  verifyApproval,
  TwoKeyError,
} from "../../work/dark-factory/dark-factory-authz.js";
import { getOctokit } from "../../outbound/github-client.js";

export interface ApprovalEvidence {
  prRef: string;
  approver: string;
  prUrl: string;
}

export type ApprovalOutcome =
  | { ok: true; evidence: ApprovalEvidence }
  | { ok: false; code: 403 | 503; body: object };

/** Why the ceremony did not pass. A `TwoKeyError` is the CEREMONY refusing (403, with the specific reason so an approver can fix it), while anything else is GitHub being unreachable (503) — the caller may retry the second and must not retry the first. */
function approvalFailure(err: unknown): ApprovalOutcome {
  if (err instanceof TwoKeyError) {
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

export async function checkApproval(
  request: Request,
  repo: string,
  fieldPaths: string[],
  detail: string,
): Promise<ApprovalOutcome> {
  const prRef = request.headers["x-lore-approval-pr"];

  if (typeof prRef !== "string" || !prRef) {
    return {
      ok: false,
      code: 403,
      body: { error: "two_key_required", field_paths: fieldPaths, detail },
    };
  }

  try {
    const octokit = await getOctokit();
    const evidence = await verifyApproval({ octokit, prRef, targetRepo: repo });

    return { ok: true, evidence };
  } catch (err) {
    return approvalFailure(err);
  }
}
