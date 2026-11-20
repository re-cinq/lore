// Starts the repository's first full ingestion when onboarding ended without a pull request to merge, because nothing else would ever start one. A workflow that cannot be started is audited against the task and the run still succeeds: the gap is for a person to read, not a reason to retry.

import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import {
  anyWorkflowsPermissionFailure,
  auditOnboardFailuresIfAny,
  startFirstIngest,
  type AuditWriter,
  type FirstIngest,
} from "@re-cinq/lore-shared/onboard/index.js";
import { projectFor } from "../../outbound/project-boot.js";
import { pipeline } from "../../outbound/queues.js";

export interface StartIngestTarget {
  repo: string;
  taskId: string;
}

export interface StartIngestDeps {
  startIngest(target: StartIngestTarget): Promise<FirstIngest>;
}

const productionDeps: StartIngestDeps = {
  startIngest: async ({ repo, taskId }) => {
    const project = await projectFor(repo);
    const ingest = await startFirstIngest(
      project.settings,
      await project.repo.defaultBranch(),
    );
    const write: AuditWriter = (entry) => pipeline().audit.write(entry);

    await auditOnboardFailuresIfAny(
      {
        taskId,
        targetRepo: repo,
        failures: ingest.gaps,
        configFailures: [],
        workflowsPermissionDenied: anyWorkflowsPermissionFailure(ingest.gaps),
      },
      write,
    );

    return ingest;
  },
};

export function startIngestHandle(deps: StartIngestDeps): Handle {
  return async ({ needs }) => {
    const { repo } = parseGitRef(needs.target);

    try {
      await deps.startIngest({ repo, taskId: needs.task_id });

      return { outcome: "success" };
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

export function startStartIngestStation(): RunningStation {
  return defineStation(
    "onboard-start-ingest",
    startIngestHandle(productionDeps),
  );
}
