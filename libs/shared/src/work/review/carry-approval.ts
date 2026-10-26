// A push that only rebased a pull request keeps Lore's approval (#3499): when the pull request changes the same lines at the new head as at the head Lore approved, the approval is published on the new head instead of a re-check judging the same change again. Over the weekend of 2026-10-23, 170 re-checks followed a rebase-only push and 149 gave the verdict before them.
import type { CheckRunInput } from "../../outbound/project/lib/github-port.js";
import type {
  CheckRun,
  FileChangeSummary,
  PullRef,
} from "../../outbound/project/pulls/pull-requests-port.js";
import {
  loreCheckName,
  loreReviewVerdict,
} from "../../outbound/project/pulls/check-runs.js";

/** What the carry reads of the pull request. */
export interface CarryReads {
  listChecks(ref: string): Promise<CheckRun[]>;
  netChange(base: string, head: string): Promise<FileChangeSummary[] | null>;
}

/** Where a carried approval is published: Lore's own check on the new head. */
export interface CarryChecks {
  upsertCheckRun(input: CheckRunInput): Promise<void>;
}

/** A rebase dropped the commit Lore judged (`sinceSha` is gone): when Lore approved that commit and the pull request still changes the same lines, the approval is published on the new head and no re-check starts. Null whenever any of that does not hold, which starts the re-check. */
export async function carryApproval(
  deps: { pulls: CarryReads; checks: CarryChecks },
  pr: Pick<PullRef, "headSha" | "baseBranch">,
  judged: string | undefined,
  sinceSha: string | undefined,
): Promise<string | null> {
  const head = pr.headSha;
  const base = pr.baseBranch ?? "main";
  const rebased = !sinceSha && judged && head;

  if (!rebased || !(await approvalHolds(deps.pulls, base, judged, head))) {
    return null;
  }
  await deps.checks.upsertCheckRun(carriedApprovalCheck(head, judged));

  return `carried the approval of ${judged.slice(0, 7)}`;
}

async function approvalHolds(
  pulls: CarryReads,
  base: string,
  judged: string,
  head: string,
): Promise<boolean> {
  const [checks, before, after] = await Promise.all([
    pulls.listChecks(judged),
    pulls.netChange(base, judged),
    pulls.netChange(base, head),
  ]);

  return (
    loreReviewVerdict(checks) === "approved" && sameNetChange(before, after)
  );
}

const HUNK_HEADER = /^@@ [^@]* @@/gm;

/** True when both heads change the same files the same way, line for line. A hunk's line numbers move when main grows above it, so they are not compared; a file GitHub gives no patch for cannot be compared, and neither can an empty change or one GitHub could not read. */
export function sameNetChange(
  judged: readonly FileChangeSummary[] | null,
  head: readonly FileChangeSummary[] | null,
): boolean {
  if (!judged || !head || judged.length === 0) {
    return false;
  }
  const comparable = [...judged, ...head].every(
    (file) => file.patch !== undefined,
  );

  return comparable && fingerprint(judged) === fingerprint(head);
}

function fingerprint(files: readonly FileChangeSummary[]): string {
  return files
    .map(
      ({ filename, status, patch }) =>
        `${status} ${filename}\n${(patch ?? "").replace(HUNK_HEADER, "@@")}`,
    )
    .sort()
    .join("\0");
}

/** The approval as the merge wait reads it: Lore's own review check, passed, on the new head. */
export function carriedApprovalCheck(
  headSha: string,
  approvedSha: string,
): CheckRunInput {
  return {
    headSha,
    name: loreCheckName("code-review"),
    status: "completed",
    conclusion: "success",
    title: "Approved: the rebase changed nothing Lore reviewed",
    summary: `Lore approved ${approvedSha.slice(0, 7)} and this push is a rebase of the same change: every file and line the pull request changes is as it was, so the approval carries over without a re-check.`,
  };
}
