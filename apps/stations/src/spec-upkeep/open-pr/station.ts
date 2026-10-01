// Opens (or finds) the one pull request of a spec upkeep run. A branch the agent left with no commit is a repository whose specs needed nothing after all: no pull request, and the run ends there.
import {
  defineStation,
  type Brief,
  type Handle,
  type Report,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import {
  ensurePull,
  type PullOpener,
} from "@re-cinq/lore-shared/project/pulls/ensure-pull.js";
import { projectFor } from "../../outbound/project-boot.js";

export interface OpenUpkeepPrDeps {
  pulls(repo: string): Promise<PullOpener>;
}

const productionDeps: OpenUpkeepPrDeps = {
  pulls: async (repo) => (await projectFor(repo)).pulls,
};

const BODY = "pr_body";
const DEFAULT_BODY =
  "Lore's weekly spec upkeep: statements that had drifted from the code are updated, and statements a test already validates are linked to it. The two are separate commits.";

/** GitHub's refusal to open a pull request from a branch that holds nothing its base lacks. */
const NOTHING_TO_OPEN = /no commits between/i;
const NOTHING_CHANGED: Report = { outcome: "nothing" };

export function openUpkeepPrHandle(deps: OpenUpkeepPrDeps): Handle {
  return async (brief, tools) => {
    const { repo, branch } = parseGitRef(brief.needs.target);

    try {
      const pr = await ensurePull(await deps.pulls(repo), branch, {
        title: `Spec upkeep ${branch.split("/").at(-1)}: drift fixes and test links`,
        body: (await proseOf(brief, tools)) || DEFAULT_BODY,
      });

      return { outcome: "success", produced: { pr_url: pr.url } };
    } catch (err) {
      return NOTHING_TO_OPEN.test(errorMessage(err))
        ? NOTHING_CHANGED
        : { outcome: "failed", error: errorMessage(err) };
    }
  };
}

async function proseOf(brief: Brief, tools: Tools): Promise<string> {
  return BODY in brief.needs
    ? (await tools.read(BODY)).toString("utf8").trim()
    : "";
}

export function startOpenUpkeepPrStation(): RunningStation {
  return defineStation(
    "spec-upkeep-open-pr",
    openUpkeepPrHandle(productionDeps),
  );
}
