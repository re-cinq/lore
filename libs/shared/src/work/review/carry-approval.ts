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

/** What a rebase of the judged commit left: Lore's approval carried to the new head, or the files whose change now differs from what it judged, null when GitHub cannot say. */
export type RebaseVerdict =
  { carried: string } | { differing: string[] | null };

/** A rebase dropped the commit Lore judged (`sinceSha` is gone): when Lore approved that commit and the pull request still changes the same lines, the approval is published on the new head and no re-check starts; otherwise the re-check is told which files differ. */
export async function judgeRebase(
  deps: { pulls: CarryReads; checks: CarryChecks },
  pr: Pick<PullRef, "headSha" | "baseBranch">,
  judged: string | undefined,
  sinceSha: string | undefined,
): Promise<RebaseVerdict> {
  const head = sinceSha || !judged ? undefined : pr.headSha;

  return head && judged
    ? carryOrDiffer(deps, { base: pr.baseBranch ?? "main", judged, head })
    : { differing: null };
}

async function carryOrDiffer(
  deps: { pulls: CarryReads; checks: CarryChecks },
  { base, judged, head }: { base: string; judged: string; head: string },
): Promise<RebaseVerdict> {
  const { approved, before, after } = await rebaseReads(
    deps.pulls,
    base,
    judged,
    head,
  );

  if (!approved || !sameNetChange(before, after)) {
    return { differing: differingFiles(before, after) };
  }
  await deps.checks.upsertCheckRun(carriedApprovalCheck(head, judged));

  return { carried: `carried the approval of ${judged.slice(0, 7)}` };
}

async function rebaseReads(
  pulls: CarryReads,
  base: string,
  judged: string,
  head: string,
) {
  const [checks, before, after] = await Promise.all([
    pulls.listChecks(judged),
    pulls.netChange(base, judged),
    pulls.netChange(base, head),
  ]);

  return { approved: loreReviewVerdict(checks) === "approved", before, after };
}

/** The files whose change differs between the judged commit and the head, a file GitHub gives no patch for counting as differing; null when GitHub could not compare either side or nothing it could read differs. */
export function differingFiles(
  judged: readonly FileChangeSummary[] | null,
  head: readonly FileChangeSummary[] | null,
): string[] | null {
  if (!judged || !head) {
    return null;
  }
  const before = new Map(judged.map((file) => [file.filename, keyOf(file)]));
  const after = new Map(head.map((file) => [file.filename, keyOf(file)]));
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  const differing = names.filter(
    (name) => before.get(name) !== after.get(name) || !before.get(name),
  );

  return differing.length > 0 ? differing : null;
}

function keyOf(file: FileChangeSummary): string {
  return file.patch === undefined
    ? ""
    : `${file.status}\n${file.patch.replace(HUNK_HEADER, "@@")}`;
}

/** The re-check's scope after a rebase that changed some files: those files' change against the base, and nothing else. */
export function rebasedScope(
  judged: string,
  files: readonly string[],
  base: string,
): string {
  const named = files.map((file) => `\`${file}\``).join(", ");

  return ` Lore's last verdict judged ${judged}, which a rebase replaced. Since then the pull request's change differs only in ${named}: read \`git -C /workspace/target diff --no-ext-diff ${base}...HEAD -- ${files.join(" ")}\` and judge only that.`;
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
    .map((file) => `${file.filename}\n${keyOf(file)}`)
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
