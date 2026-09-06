/** The onboarding PR's "what went wrong" section. */

import {
  classifyError,
  failureHint,
  type StepFailure,
} from "@re-cinq/lore-shared";

/** Failure message safe for markdown bullets: collapsed newlines and length-capped. */
const asBulletText = (error: string): string => {
  const flat = error.replace(/\s+/g, " ").trim();

  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
};

/** True when any failure is missing Workflows App permission (shared detector, not status keying). */
export const anyWorkflowsPermissionFailure = (
  failures: StepFailure[],
): boolean =>
  failures.some(
    (f) =>
      classifyError(f.error, f.step).category === "github-workflows-permission",
  );

/** Lines listing files that could not be committed, or none when there were no failures. */
function failedFilesLines(failures: StepFailure[]): string[] {
  if (failures.length === 0) {
    return [];
  }
  const lines = ["These files could not be committed:", ""];

  for (const f of failures) {
    lines.push(`- \`${f.step}\` — ${asBulletText(f.error)}`);
  }
  lines.push("");

  return lines;
}

/** Lines listing ingest-callback configuration failures, or none when there were no failures. */
function configFailureLines(configFailures: string[]): string[] {
  if (configFailures.length === 0) {
    return [];
  }
  const lines = ["Ingest callback configuration:", ""];

  for (const failure of configFailures) {
    lines.push(`- ${asBulletText(failure)}`);
  }
  lines.push("");

  return lines;
}

/** Onboarding PR's "what went wrong" section; missing workflows/config block re-ingest. */
export function onboardAttentionSection(
  failures: StepFailure[],
  configFailures: string[],
  workflowsPermissionDenied: boolean,
): string {
  if (failures.length === 0 && configFailures.length === 0) {
    return "";
  }
  const lines = ["", "## Needs attention", "", ...failedFilesLines(failures)];

  if (workflowsPermissionDenied) {
    lines.push(
      `GitHub rejected the workflow files: ${failureHint("github-workflows-permission")} Then re-run onboarding (or use the dashboard's fix-ingest button).`,
      "",
    );
  }
  lines.push(...configFailureLines(configFailures));

  return lines.join("\n").replace(/\n+$/, "");
}
