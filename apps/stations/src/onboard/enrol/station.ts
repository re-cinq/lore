import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
// Enrols the repository the onboard run was started on: its labels, the ingest callback and the verbatim scaffolding on the run's branch. What could not be done is produced as `attention`, which the pull request then carries.

import {
  defineStation,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import {
  enrolRepo,
  type EnrolTarget,
  type Enrolment,
} from "@re-cinq/lore-shared/onboard/enrol-repo.js";
import { commitFile } from "@re-cinq/lore-shared/project/lib/platform-github-repo-content.js";
import type { ScaffoldRepo } from "@re-cinq/lore-shared/onboard/onboard-scaffold.js";
import { Octokit } from "octokit";
import { projectFor } from "../../outbound/project-boot.js";
import { pipeline } from "../../outbound/queues.js";

export interface EnrolDeps {
  /** `credential`, when the run carries one, is the token the commits are made with; without it the App commits. */
  enrol(target: EnrolTarget, credential?: string): Promise<Enrolment>;
}

const productionDeps: EnrolDeps = {
  enrol: async (target, credential) => {
    const { repo, settings, issues } = await projectFor(target.repo);

    return enrolRepo(
      {
        repo: credential ? committingAs(repo, credential, target.repo) : repo,
        settings,
        issues,
        audit: (entry) => pipeline().audit.write(entry),
      },
      target,
    );
  },
};

function committingAs(
  repo: ScaffoldRepo,
  credential: string,
  repoName: string,
): ScaffoldRepo {
  const ok = new Octokit({ auth: credential });

  return {
    read: (path, ref) => repo.read(path, ref),
    commitFile: (branch, path, content, message) =>
      commitFile(ok, repoName, branch, { path, content, message }),
  };
}

export function enrolHandle(deps: EnrolDeps): Handle {
  return async ({ needs }, tools) => {
    const { repo, branch } = parseGitRef(needs.target);

    try {
      const credential = await carriedCredential(needs, tools);
      const { attention } = await deps.enrol(
        { repo, branch, taskId: needs.task_id },
        credential,
      );

      return { outcome: "success", produced: { attention } };
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

/** A declared credential that is blank is an error: falling back to the App would defeat FR-296. */
async function carriedCredential(
  needs: Record<string, string>,
  tools: Tools,
): Promise<string | undefined> {
  if (!("credential" in needs)) {
    return undefined;
  }

  const credential = (await tools.read("credential")).toString("utf8").trim();

  enforceTrue(credential, Error, "the run's credential is blank");

  return credential;
}

export function startEnrolStation(): RunningStation {
  return defineStation("onboard-enrol", enrolHandle(productionDeps));
}
