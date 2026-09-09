/** Post-commit bookkeeping: an audit entry for failed files, and the repo's dispatch labels. */

import {
  errorMessage,
  BACKLOG_LABEL_SEED,
  type StepFailure,
} from "@re-cinq/lore-shared";
import { DISPATCH_LABELS } from "@re-cinq/lore-shared/task-types/dispatch-labels.js";
import { writeAuditLog } from "../../outbound/audit.js";
import { projectFor } from "../../outbound/project-boot.js";
import type { TaskHandlerInput } from "./task-handler-input.js";

/** What an onboard-failure audit entry needs; grouped because `handleOnboard` already tracked every field before deciding whether to write one. */
export interface OnboardFailureAudit {
  task: TaskHandlerInput["task"];
  targetRepo: string;
  failures: StepFailure[];
  configFailures: string[];
  workflowsPermissionDenied: boolean;
}

/** Records a failed-files audit entry only when there was something to report. */
export async function auditOnboardFailuresIfAny(
  audit: OnboardFailureAudit,
): Promise<void> {
  if (audit.failures.length === 0 && audit.configFailures.length === 0) {
    return;
  }

  await writeOnboardFailureAudit(audit);
}

/** The audit row itself; a failure to write it is warned about, never raised — the audit trail is not worth failing an onboarding for. */
async function writeOnboardFailureAudit(
  audit: OnboardFailureAudit,
): Promise<void> {
  await writeAuditLog({
    event_type: "onboard_files_failed",
    task_id: audit.task.id,
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
    console.warn(`[floor] Onboard: audit write failed: ${errorMessage(err)}`),
  );
}

/** Best-effort dispatch-label setup; a failure here doesn't block onboarding. */
export async function createDispatchLabels(
  project: Awaited<ReturnType<typeof projectFor>>,
  targetRepo: string,
): Promise<void> {
  try {
    await project.issues.createLabels(dispatchLabelSeed());
    console.log(`[floor] Created Lore dispatch labels on ${targetRepo}`);
  } catch (err) {
    console.warn(
      `[floor] Failed to create labels on ${targetRepo}: ${(err as Error).message}`,
    );
  }
}

/** Every label a dispatch-driven repo needs: the `lore` entry point, the per-task-type dispatch set, and the backlog seed. */
function dispatchLabelSeed(): {
  name: string;
  color: string;
  description: string;
}[] {
  return [
    { name: "lore", color: "7B61FF", description: "Dispatch to Lore agent" },
    ...DISPATCH_LABELS.map(({ name, color, description }) => ({
      name,
      color,
      description,
    })),
    ...BACKLOG_LABEL_SEED,
  ];
}
