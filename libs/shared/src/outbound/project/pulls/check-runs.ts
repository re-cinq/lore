import type {
  CheckRun,
  CiConclusion,
  JobFailure,
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

/** The failed check NAMES (the reliable signal — a job's output is often just "Process completed with exit code 1") and their rendered detail, capped. Grouped by NAME because two workflows may each publish a job called `build`, and "build, build" names nothing a reader can act on. */
export function summarizeFailedChecks(
  checks: readonly CheckRun[],
  maxChars: number = MAX_SUMMARY_CHARS,
): { names: string[]; summary: string } {
  const byName = groupByName(failedCheckRuns(checks));
  const summary = [...byName]
    .map(([name, runs]) => failureBlock(name, runs))
    .filter((block) => block.length > 0)
    .join("\n\n");

  return {
    names: [...byName.keys()],
    summary:
      summary.length > maxChars
        ? `${summary.substring(0, maxChars)}\n...(truncated)`
        : summary,
  };
}

/** Failed runs keyed by check name, insertion-ordered so the first failure GitHub listed stays first. */
function groupByName(runs: readonly CheckRun[]): Map<string, CheckRun[]> {
  const byName = new Map<string, CheckRun[]>();

  for (const run of runs) {
    byName.set(run.name, [...(byName.get(run.name) ?? []), run]);
  }

  return byName;
}

/** The newest commit a CI verdict can be read from, or null when every commit skipped CI. Not simply the head: the repo's own format job commits `style: prettier [skip ci]` onto the branch, and checks never appear on that sha — reading the head would leave a run waiting forever. Commits arrive oldest-first, as GitHub lists them. */
export function ciJudgedSha(commits: readonly PullCommit[]): string | null {
  const judged = [...commits].reverse().find((c) => !skipsCi(c.message));

  return judged ? judged.sha : null;
}

/** Everything the jobs of one check name reported, or "" when they reported nothing — which is the ordinary case for an Actions job, and why a heading alone is not worth rendering. */
function failureBlock(name: string, runs: readonly CheckRun[]): string {
  const reported = runs
    .flatMap(reportedParts)
    .filter((part): part is string => typeof part === "string" && part !== "");

  return reported.length === 0
    ? ""
    : [`### ${name} (${runs[0].conclusion})`, ...reported].join("\n\n");
}

/** Everything one run says about its failure: what it reported in its check run, then what its job's own log says. */
function reportedParts(run: CheckRun): Array<string | null | undefined> {
  return [
    run.output?.title,
    run.output?.summary,
    ...jobFailureParts(run.jobFailure),
  ];
}

/** An Actions job's own account of its failure: where (its failure annotations), then the step that failed, then what it printed. */
function jobFailureParts(failure: JobFailure | undefined): string[] {
  return failure
    ? [
        failure.annotations.join("\n"),
        `Failed step: ${failure.steps.join(", ")}`,
        failure.tail.join("\n"),
      ]
    : [];
}

/** True when this commit message tells GitHub to run nothing for it. */
function skipsCi(message: string): boolean {
  const lower = message.toLowerCase();

  return SKIP_CI_MARKERS.some((marker) => lower.includes(marker));
}

/** The line GitHub writes when a step's command exits non-zero: where a failing step's output ends. */
const STEP_EXIT_MARKER = "##[error]Process completed with exit code";

/** The line closing a step's command header: where its output begins. */
const STEP_HEADER_END = "##[endgroup]";

/** What the failing step printed, from an Actions job log: the lines between its command header and its exit line, without timestamps, `##[error]` markers or blanks. It is the part a reader needs and the part an Actions check run's own output never carries. */
export function failureTail(log: string): string[] {
  const lines = log.split("\n").map(withoutTimestamp);
  const exit = lines.findIndex((line) => line.startsWith(STEP_EXIT_MARKER));

  if (exit < 0) {
    return [];
  }
  const header = lines.lastIndexOf(STEP_HEADER_END, exit);

  return lines
    .slice(header + 1, exit)
    .map((line) => line.replace(/^##\[error\]/, "").trim())
    .filter((line) => line !== "");
}

/** A log line without the timestamp Actions prefixes to every line. */
function withoutTimestamp(line: string): string {
  return line.replace(/^\uFEFF?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "").trimEnd();
}
