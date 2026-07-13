/**
 * The two-key CODEOWNERS-approval ceremony shared by the dark-factory settings
 * PUT and the agent-definitions `image` writes (ADR-016/ADR-025). A privileged
 * change needs an `X-Lore-Approval-PR` header referencing an open PR labeled
 * `dark-factory-approval` by a CODEOWNER of the repo's CLAUDE.md.
 *
 * Returns the outcome rather than writing the response, so each native route
 * shapes its own ceremony from the evidence (dark-factory keeps `pr_url`, agents
 * does not) and turns a denial into `h.response(body).code(code)`.
 */

import type { Request } from "@hapi/hapi";
import {
  verifyApproval,
  TwoKeyError,
} from "../../features/dark-factory/dark-factory-authz.js";
import { getOctokit } from "../../platform/github-client.js";

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
}
