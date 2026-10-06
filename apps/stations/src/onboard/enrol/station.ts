// Enrols the repository the onboard run was started on: its labels, the ingest callback and the verbatim scaffolding on the run's branch. What could not be done is produced as `attention`, which the pull request then carries.

import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import {
  enrolRepo,
  type EnrolTarget,
  type Enrolment,
} from "@re-cinq/lore-shared/onboard/enrol-repo.js";
import { projectFor } from "../../outbound/project-boot.js";
import { pipeline } from "../../outbound/queues.js";

export interface EnrolDeps {
  enrol(target: EnrolTarget): Promise<Enrolment>;
}

const productionDeps: EnrolDeps = {
  enrol: async (target) => {
    const { repo, settings, issues } = await projectFor(target.repo);

    return enrolRepo(
      {
        repo,
        settings,
        issues,
        audit: (entry) => pipeline().audit.write(entry),
      },
      target,
    );
  },
};

export function enrolHandle(deps: EnrolDeps): Handle {
  return async ({ needs }) => {
    const { repo, branch } = parseGitRef(needs.target);

    try {
      const { attention } = await deps.enrol({
        repo,
        branch,
        taskId: needs.task_id,
      });

      return { outcome: "success", produced: { attention } };
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

export function startEnrolStation(): RunningStation {
  return defineStation("onboard-enrol", enrolHandle(productionDeps));
}
