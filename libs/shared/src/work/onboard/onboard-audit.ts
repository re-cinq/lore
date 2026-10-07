/** Enrolment bookkeeping: an audit entry for what could not be done, and the repo's dispatch labels. */

import { errorMessage, type StepFailure } from "../../lib/error-classify.js";
import { DISPATCH_LABELS } from "../../domain/task-types/dispatch-labels.js";
import type { AuditLogEntry } from "../../outbound/project/audit/audit-port.js";
import { BACKLOG_LABEL_SEED } from "../backlog/labels.js";

/** What an onboard-failure audit entry needs. */
export interface OnboardFailureAudit {
  taskId: string;
  targetRepo: string;
  failures: StepFailure[];
  configFailures: string[];
  workflowsPermissionDenied: boolean;
}

export type AuditWriter = (entry: AuditLogEntry) => Promise<void>;

/** Records a failed-files audit entry only when there was something to report. */
export async function auditOnboardFailuresIfAny(
  audit: OnboardFailureAudit,
  write: AuditWriter,
): Promise<void> {
  if (audit.failures.length === 0 && audit.configFailures.length === 0) {
    return;
  }

  await writeOnboardFailureAudit(audit, write);
}

/** The audit row itself; a failure to write it is warned about, never raised — the audit trail is not worth failing an onboarding for. */
async function writeOnboardFailureAudit(
  audit: OnboardFailureAudit,
  write: AuditWriter,
): Promise<void> {
  await write({
    event_type: "onboard_files_failed",
    task_id: audit.taskId,
    repo: audit.targetRepo,
    payload: {
      failed_files: audit.failures.map((f) => ({
        path: f.step,
        error: f.error,
      })),
      config_failures: audit.configFailures,
      workflows_permission_denied: audit.workflowsPermissionDenied,
    },
  }).catch((err) =>
    console.warn(`[onboard] audit write failed: ${errorMessage(err)}`),
  );
}

interface LabelSeed {
  name: string;
  color: string;
  description: string;
}

/** The slice of `project.issues` the label seeding writes through. */
export interface LabelIssues {
  createLabels(labels: LabelSeed[]): Promise<unknown>;
}

/** Best-effort dispatch-label setup; a failure here doesn't block onboarding. */
export async function createDispatchLabels(
  issues: LabelIssues,
  targetRepo: string,
): Promise<void> {
  try {
    await issues.createLabels(dispatchLabelSeed());
    console.log(`[onboard] Created Lore dispatch labels on ${targetRepo}`);
  } catch (err) {
    console.warn(
      `[onboard] Failed to create labels on ${targetRepo}: ${errorMessage(err)}`,
    );
  }
}

const TRIAGE_LABEL_SEED: LabelSeed[] = [
  {
    name: "triage: needs-triage",
    color: "e4e669",
    description: "Awaiting initial triage",
  },
  {
    name: "triage: needs-reproduction",
    color: "f9d0c4",
    description: "Awaiting reproduction steps",
  },
  {
    name: "triage: reproduced",
    color: "0075ca",
    description: "Issue has been reproduced",
  },
  {
    name: "triage: unable-to-reproduce",
    color: "cfd3d7",
    description: "Could not reproduce the issue",
  },
  {
    name: "triage: diagnosed",
    color: "bfd4f2",
    description: "Root cause identified",
  },
  {
    name: "triage: skipped",
    color: "cfd3d7",
    description: "Triage skipped intentionally",
  },
  {
    name: "triage: not-actionable",
    color: "cfd3d7",
    description: "No action will be taken",
  },
  {
    name: "triage: failed",
    color: "b60205",
    description: "Triage process failed",
  },
];

/** Every label a dispatch-driven repo needs: the `lore` entry point, the per-task-type dispatch set, the backlog seed, and the triage set. */
function dispatchLabelSeed(): LabelSeed[] {
  return [
    { name: "lore", color: "7B61FF", description: "Dispatch to Lore agent" },
    ...DISPATCH_LABELS.map(({ name, color, description }) => ({
      name,
      color,
      description,
    })),
    ...BACKLOG_LABEL_SEED,
    ...TRIAGE_LABEL_SEED,
  ];
}
