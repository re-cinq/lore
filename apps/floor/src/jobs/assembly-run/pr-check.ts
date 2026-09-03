/** Maps an assembly-line row + node walk rows to a GitHub check run (generic, keyed off `args.pr_number`+`args.head_sha`), which also blocks merge while `in_progress` if the repo makes it a required status check. */

import type {
  StationRunRecord,
  AssemblyRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import { writeAuditLog } from "../lib/audit.js";
import { isFailureOutcome } from "./notify-failure.js";
import {
  isReviewDefinition,
  REVIEW_RERUN_HINT,
} from "@re-cinq/lore-shared/review/review-definitions.js";

/** The repo-bound surface the publisher writes through (project.repo). */
export interface CheckPublisher {
  upsertCheckRun(input: CheckRunInput): Promise<void>;
}

/** The fast per-push re-check publishes under the deep review's check name so a required `lore/code-review` branch-protection check is refreshed on every push, not stranded under a separate name. */
const CHECK_NAME_ALIAS: Record<string, string> = {
  "code-review-recheck": "code-review",
};

export function checkName(blueprintName: string): string {
  return CHECK_NAME_ALIAS[blueprintName] ?? blueprintName;
}

export function assemblyLineCheck(
  line: AssemblyRunRecord,
  nodes: readonly StationRunRecord[],
  uiUrl?: string,
): CheckRunInput | null {
  const prNumber = Number(line.args.pr_number);
  const headSha =
    typeof line.args.head_sha === "string" ? line.args.head_sha : "";

  if (!prNumber || !headSha) {
    return null;
  }
  const displayName = checkName(line.blueprintName);
  const base = {
    headSha,
    name: `lore/${displayName}`,
    title: `Lore ${displayName}`,
    ...(uiUrl ? { detailsUrl: `${uiUrl}/assembly-runs/${line.id}` } : {}),
  };

  if (line.status === "queued" || line.status === "running") {
    return {
      ...base,
      status: "in_progress",
      summary: `Running — ${line.blueprintName}.`,
    };
  }

  const { conclusion, summary } = terminal(line, nodes);

  return { ...base, status: "completed", conclusion, summary };
}

function terminal(
  line: AssemblyRunRecord,
  nodes: readonly StationRunRecord[],
): {
  conclusion: NonNullable<CheckRunInput["conclusion"]>;
  summary: string;
} {
  // Key on outcome, not status: `outcome: "failed"` still closes the row as `finished`, so any non-benign outcome publishes a red check.
  if (isFailureOutcome(line.outcome ?? "")) {
    const why = line.reason ? ` — ${line.reason}` : "";
    const rerunHint = isReviewDefinition(line.blueprintName)
      ? ` ${REVIEW_RERUN_HINT}`
      : "";

    return {
      conclusion: "failure",
      summary: `${line.blueprintName} failed${why}.${rerunHint}`,
    };
  }

  if (line.outcome === "pr_closed") {
    return { conclusion: "cancelled", summary: "PR closed." };
  }

  // The code-review walk routes `changes_requested` → done, so the LINE outcome reads "completed" — read the verdict from the node rows instead (latest iteration wins), or the check misreads "Approved.".
  if (
    line.outcome === "changes_requested" ||
    latestNodeOutcomes(nodes).includes("changes_requested")
  ) {
    return {
      conclusion: "neutral",
      summary:
        "Changes suggested — reply to a review comment to apply, or push a fix.",
    };
  }

  return { conclusion: "success", summary: "Approved." };
}

function latestNodeOutcomes(nodes: readonly StationRunRecord[]): string[] {
  const latest = new Map<string, StationRunRecord>();

  for (const node of nodes) {
    const prev = latest.get(node.nodeId);

    if (!prev || node.iteration > prev.iteration) {
      latest.set(node.nodeId, node);
    }
  }

  return [...latest.values()].map((node) => node.outcome ?? "");
}

/** Best-effort publish — a check failure (e.g. missing `checks: write`) never fails the line. */
export async function publishPrCheck(
  repo: CheckPublisher,
  line: AssemblyRunRecord,
  nodes: readonly StationRunRecord[],
  uiUrl?: string,
): Promise<void> {
  const check = assemblyLineCheck(line, nodes, uiUrl);

  if (!check) {
    return;
  }

  try {
    await repo.upsertCheckRun(check);
  } catch (err) {
    const message = (err as Error).message;

    // Non-fatal but never silent: "Resource not accessible by integration" means the App is missing `checks`, so the merge gate is absent, not clean.
    console.error("[pr-check] publish failed:", message);
    await writeAuditLog({
      event_type: "pr_check_publish_failed",
      repo: line.repo,
      payload: {
        assembly_run_id: line.id,
        definition: line.blueprintName,
        check: check.name,
        error: message,
      },
    });
  }
}
