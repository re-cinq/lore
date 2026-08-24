/**
 * This process's implementation of the ports a sweep reaches data through.
 *
 * The composition root for stations: the registry lives in a package shared with
 * a pod that has no pool, so a station cannot resolve its own database — it is
 * GIVEN one, here, by the process that has it.
 */

import { getApprovalLabel } from "@re-cinq/lore-shared";
import type { StationHost, StationRepo } from "@re-cinq/lore-station-registry";
import { cost, memoryLifecycle, pipeline } from "./queues.js";
import { projectFor } from "./project-boot.js";

const AWAITING_APPROVAL = "awaiting_approval";
const PENDING = "pending";

async function repoFor(repo: string): Promise<StationRepo> {
  const project = await projectFor(repo);

  return {
    labelsOn: (issueNumber) => project.issues.getLabels(issueNumber),
    approve: async (taskId) => {
      await project.tasks.setStatus(taskId, PENDING);
      await project.tasks.recordEvent(taskId, AWAITING_APPROVAL, PENDING, {
        reason: "approved-via-label",
      });
    },
    removeLabel: (issueNumber, label) =>
      project.issues.removeLabel(issueNumber, label),
    comment: (issueNumber, body) => project.issues.comment(issueNumber, body),
  };
}

/**
 * This service holds a pool AND a GitHub App, so it serves every port — the
 * scheduled data operations as readily as the repo sweeps. lore-api's host
 * serves only the data half and says so; nothing here needs to.
 */
export const stationHost = (): StationHost => ({
  awaitingApproval: () => pipeline().taskQueue.awaitingApproval(),
  approvalLabel: getApprovalLabel,
  repoFor,
  memoryLifecycle,
  cost,
});
