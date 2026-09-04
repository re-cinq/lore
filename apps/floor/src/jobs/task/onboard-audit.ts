/** Post-commit bookkeeping: an audit entry for failed files, and the repo's dispatch labels. */

import {
  errorMessage,
  BACKLOG_LABEL_SEED,
  type StepFailure,
} from "@re-cinq/lore-shared";
import { DISPATCH_LABELS } from "@re-cinq/lore-shared/task-types/dispatch-labels.js";
import { writeAuditLog } from "../lib/audit.js";
import { projectFor } from "../../composition/project-boot.js";
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
  const {
    task,
    targetRepo,
    failures,
    configFailures,
    workflowsPermissionDenied,
  } = audit;

  if (failures.length === 0 && configFailures.length === 0) {
    return;
  }

  await writeAuditLog({
    event_type: "onboard_files_failed",
    task_id: task.id,
    repo: targetRepo,
    payload: {
      failed_files: failures.map((f) => ({ path: f.step, error: f.error })),
      config_failures: configFailures,
      workflows_permission_denied: workflowsPermissionDenied,
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
    await project.issues.createLabels([
      { name: "lore", color: "7B61FF", description: "Dispatch to Lore agent" },
      ...DISPATCH_LABELS.map(({ name, color, description }) => ({
        name,
        color,
        description,
      })),
      ...BACKLOG_LABEL_SEED,
    ]);
    console.log(`[floor] Created Lore dispatch labels on ${targetRepo}`);
  } catch (err) {
    console.warn(
      `[floor] Failed to create labels on ${targetRepo}: ${(err as Error).message}`,
    );
  }
}
