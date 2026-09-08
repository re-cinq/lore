import type {
  CheckRun,
  CiConclusion,
  PullCommit,
} from "./pull-requests-port.js";

/** Check-run conclusions that make the whole ref red. */
const FAILED_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "stale",
]);

/** Checks Lore itself publishes; the loop's CI verdict ignores them, or a run waits on its own review check while the PR is still a draft. */
const LORE_CHECK_PREFIX = "lore/";

/** Markers GitHub honours to skip a workflow run — a commit carrying one gets no checks, so it can never be the sha a verdict is read from. */
export const SKIP_CI_MARKERS = [
  "[skip ci]",
  "[ci skip]",
  "[no ci]",
  "[skip actions]",
  "[actions skip]",
];

/** The aggregate verdict for a ref's check runs — the pure half of `ciConclusion`, so a caller holding the runs already need not fetch them twice. */
export function ciConclusionOf(checks: readonly CheckRun[]): CiConclusion {
  if (checks.length === 0) {
    return "none";
  }

  if (checks.some((run) => run.status !== "completed")) {
    return "pending";
  }

  return checks.some(isFailedRun) ? "failure" : "success";
}

/** A completed run whose conclusion makes the ref red; a null conclusion is not a failure. */
function isFailedRun(run: CheckRun): boolean {
  return run.conclusion != null && FAILED_CONCLUSIONS.has(run.conclusion);
}

/** The failed runs, in the order GitHub listed them. */
export function failedCheckRuns(checks: readonly CheckRun[]): CheckRun[] {
  return checks.filter(isFailedRun);
}

/** Checks published by somebody other than Lore — what "CI" means when the question is whether the branch itself is green. */
export function externalCheckRuns(checks: readonly CheckRun[]): CheckRun[] {
  return checks.filter((run) => !run.name.startsWith(LORE_CHECK_PREFIX));
}

/** How much of a CI report the next prompt carries, matching the failure-feedback cap the launcher already applies. */
const MAX_SUMMARY_CHARS = 2500;

/** The failed check NAMES (the reliable signal — a job's output is often just "Process completed with exit code 1") and their rendered detail, capped. */
export function summarizeFailedChecks(
  checks: readonly CheckRun[],
  maxChars: number = MAX_SUMMARY_CHARS,
): { names: string[]; summary: string } {
  const failed = failedCheckRuns(checks);
  const summary = failed.map(failureBlock).join("\n\n");

  return {
    names: failed.map((run) => run.name),
    summary:
      summary.length > maxChars
        ? `${summary.substring(0, maxChars)}\n...(truncated)`
        : summary,
  };
}

/** The newest commit a CI verdict can be read from, or null when every commit skipped CI. Not simply the head: the repo's own format job commits `style: prettier [skip ci]` onto the branch, and checks never appear on that sha — reading the head would leave a run waiting forever. Commits arrive oldest-first, as GitHub lists them. */
export function ciJudgedSha(commits: readonly PullCommit[]): string | null {
  const judged = [...commits].reverse().find((c) => !skipsCi(c.message));

  return judged ? judged.sha : null;
}

/** One failed check as the prompt shows it: what failed, then whatever the job said about it. */
function failureBlock(run: CheckRun): string {
  return [
    `### ${run.name} (${run.conclusion})`,
    run.output?.title,
    run.output?.summary,
  ]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join("\n\n");
}

/** True when this commit message tells GitHub to run nothing for it. */
function skipsCi(message: string): boolean {
  const lower = message.toLowerCase();

  return SKIP_CI_MARKERS.some((marker) => lower.includes(marker));
}
