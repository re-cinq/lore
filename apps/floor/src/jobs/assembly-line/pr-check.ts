/**
 * Maps an assembly-line row to a GitHub check run, so any PR-linked line's live
 * state shows in the PR's checks section (with a details link to the Lore UI).
 * Generic: keyed off `args.pr_number` + `args.head_sha`, so a `code-review`,
 * `comment-triage`, or any future PR-linked line all publish a check for free.
 *
 * The `in_progress` check is also what blocks merge while a review runs — once a
 * repo makes `lore/code-review` a required status check, `neutral`/`success`
 * satisfy it so the block lifts only when the review completes.
 */

import type { AssemblyLineRecord } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";

/** The repo-bound surface the publisher writes through (project.repo). */
export interface CheckPublisher {
  upsertCheckRun(input: CheckRunInput): Promise<void>;
}

export function assemblyLineCheck(
  line: AssemblyLineRecord,
  uiUrl?: string,
): CheckRunInput | null {
  const prNumber = Number(line.args.pr_number);
  const headSha =
    typeof line.args.head_sha === "string" ? line.args.head_sha : "";

  if (!prNumber || !headSha) {
    return null;
  }
  const base = {
    headSha,
    name: `lore/${line.definitionName}`,
    title: `Lore ${line.definitionName}`,
    ...(uiUrl ? { detailsUrl: `${uiUrl}/assembly-lines/${line.id}` } : {}),
  };

  if (line.status === "queued" || line.status === "running") {
    return {
      ...base,
      status: "in_progress",
      summary: `Running — ${line.definitionName}.`,
    };
  }

  const { conclusion, summary } = terminal(line);

  return { ...base, status: "completed", conclusion, summary };
}

function terminal(line: AssemblyLineRecord): {
  conclusion: NonNullable<CheckRunInput["conclusion"]>;
  summary: string;
} {
  if (line.status === "failed" || line.outcome === "error") {
    return { conclusion: "failure", summary: `${line.definitionName} failed.` };
  }
  if (line.outcome === "changes_requested") {
    return {
      conclusion: "neutral",
      summary:
        "Changes suggested — reply to a review comment to apply, or push a fix.",
    };
  }
  if (line.outcome === "pr_closed") {
    return { conclusion: "cancelled", summary: "PR closed." };
  }

  return { conclusion: "success", summary: "Approved." };
}

/** Best-effort publish — a check failure (e.g. missing `checks: write`) never fails the line. */
export async function publishPrCheck(
  repo: CheckPublisher,
  line: AssemblyLineRecord,
  uiUrl?: string,
): Promise<void> {
  const check = assemblyLineCheck(line, uiUrl);

  if (!check) {
    return;
  }
  try {
    await repo.upsertCheckRun(check);
  } catch (err) {
    console.warn("[pr-check] publish failed:", (err as Error).message);
  }
}
