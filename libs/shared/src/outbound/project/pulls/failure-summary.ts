import { failedCheckRuns, npmScriptOf, type NpmScript } from "./check-runs.js";
import type { CheckRun, JobFailure } from "./pull-requests-port.js";

/** How much of a CI report the next prompt carries, matching the failure-feedback cap the launcher already applies. */
const MAX_SUMMARY_CHARS = 2500;

/** The failed check NAMES (the reliable signal — a job's output is often just "Process completed with exit code 1") and their rendered detail, capped. Grouped by NAME because two workflows may each publish a job called `build`, and "build, build" names nothing a reader can act on. */
export function summarizeFailedChecks(
  checks: readonly CheckRun[],
  maxChars: number = MAX_SUMMARY_CHARS,
): { names: string[]; summary: string } {
  const failed = failedCheckRuns(checks);
  const byName = groupByName(failed);
  const room = outputRoom(byName, failed, maxChars);

  return {
    names: [...byName.keys()],
    summary: capped(renderSummary(byName, room), maxChars),
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

/** The characters each step's printed output may take: what the cap leaves once everything else is rendered, shared by the runs that printed something. */
function outputRoom(
  byName: Map<string, CheckRun[]>,
  failed: readonly CheckRun[],
  maxChars: number,
): number {
  const printing = failed.filter(printedOutput).length;
  const room = maxChars - renderSummary(byName, 0).length;

  return printing === 0 ? 0 : Math.max(0, Math.floor(room / printing));
}

/** True when the run's job log gave the failing step's output. */
function printedOutput(run: CheckRun): boolean {
  const tail = run.jobFailure?.tail ?? [];

  return tail.length > 0;
}

/** Every check name's block, with each step's output held to `outputChars`. */
function renderSummary(
  byName: Map<string, CheckRun[]>,
  outputChars: number,
): string {
  return [...byName]
    .map(([name, runs]) => failureBlock(name, runs, outputChars))
    .filter((block) => block.length > 0)
    .join("\n\n");
}

/** The summary cut at the cap, as a last resort once the outputs are already held to their room: a check run's own summary can still overrun it. */
function capped(summary: string, maxChars: number): string {
  return summary.length > maxChars
    ? `${summary.substring(0, maxChars)}\n...(truncated)`
    : summary;
}

/** Everything the jobs of one check name reported, or "" when they reported nothing — which is the ordinary case for an Actions job, and why a heading alone is not worth rendering. */
function failureBlock(
  name: string,
  runs: readonly CheckRun[],
  outputChars: number,
): string {
  const reported = runs
    .flatMap((run) => reportedParts(run, outputChars))
    .filter((part): part is string => typeof part === "string" && part !== "");

  return reported.length === 0
    ? ""
    : [`### ${name} (${runs[0].conclusion})`, ...reported].join("\n\n");
}

/** Everything one run says about its failure: what it reported in its check run, then what its job's own log says. */
function reportedParts(
  run: CheckRun,
  outputChars: number,
): Array<string | null | undefined> {
  return [
    run.output?.title,
    run.output?.summary,
    ...jobFailureParts(run.jobFailure, outputChars),
  ];
}

/** An Actions job's own account of its failure: where (its failure annotations), then the step that failed and the npm script it ran, then what it printed. */
function jobFailureParts(
  failure: JobFailure | undefined,
  outputChars: number,
): string[] {
  return failure
    ? [
        failure.annotations.join("\n"),
        failedStepLine(failure.steps),
        ranAsLine(npmScriptOf(failure.tail)),
        outputEnd(failure.tail, outputChars),
        refusedReadsLine(failure.unreadable ?? []),
      ]
    : [];
}

const OUTPUT_CUT = "...(earlier output cut)";

/** What a step printed, within `chars`: the END of it, because a monorepo's test step prints every passing package before the one that failed (otto run 82f38496 lost its failure to the coverage tables above it). */
function outputEnd(lines: readonly string[], chars: number): string {
  const whole = lines.join("\n");

  if (whole.length <= chars) {
    return whole;
  }
  const kept: string[] = [];
  let length = OUTPUT_CUT.length;

  for (const line of [...lines].reverse()) {
    length += line.length + 1;

    if (length > chars) {
      break;
    }
    kept.unshift(line);
  }

  return [OUTPUT_CUT, ...kept].join("\n");
}

/** The steps that failed, or nothing when the job could not be read — an empty `Failed step:` would read as a job with no failing step. */
function failedStepLine(steps: readonly string[]): string {
  return steps.length === 0 ? "" : `Failed step: ${steps.join(", ")}`;
}

/** The reads GitHub refused, said out loud: without it a refused log reads as a job that printed nothing, and an agent goes looking for a failure it was never shown. */
function refusedReadsLine(unreadable: readonly string[]): string {
  return unreadable.length === 0
    ? ""
    : `GitHub refused: ${unreadable.join(", ")}`;
}

/** The verdict's line naming where CI ran the step, or nothing when it did not run through npm. */
function ranAsLine(npmScript: NpmScript | null): string {
  return npmScript
    ? `Ran as: npm script \`${npmScript.script}\` of package \`${npmScript.package}\``
    : "";
}
