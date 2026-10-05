// Opens (or finds) the pull request carrying what spec-write pushed, the same direct-GitHub-write shape the review family's own stations use (see specs/external-floor/spec.md FR8.6).

import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { ensurePull } from "@re-cinq/lore-shared/project/pulls/ensure-pull.js";
import { specPathOfPlan } from "@re-cinq/lore-shared/feature-planning/spec-plan-path.js";
import { projectFor } from "../../outbound/project-boot.js";

export interface OpenSpecPrProject {
  pulls: {
    list(): Promise<PullRef[]>;
    open(branch: string, pr: { title: string; body: string }): Promise<PullRef>;
  };
}

export interface OpenSpecPrDeps {
  project(repo: string): Promise<OpenSpecPrProject>;
}

const productionDeps: OpenSpecPrDeps = {
  project: async (repo) => {
    const { pulls } = await projectFor(repo);

    return { pulls };
  },
};

export function openSpecPrHandle(deps: OpenSpecPrDeps): Handle {
  return async (brief, tools) => {
    const { repo, branch } = parseGitRef(brief.needs.target);

    try {
      const project = await deps.project(repo);
      const pr = await ensurePr(project.pulls, branch, brief.needs.plan_title);
      const specPlan = await tools.read("spec_plan");

      return reported(pr.url, specPathOfPlan(specPlan.toString("utf8")));
    } catch (err) {
      return { outcome: "failed", error: (err as Error).message };
    }
  };
}

function ensurePr(
  pulls: OpenSpecPrProject["pulls"],
  branch: string,
  planTitle: string | undefined,
): Promise<PullRef> {
  return ensurePull(pulls, branch, {
    title: prTitle(branch, planTitle),
    body: `Opened by the Lore feature-planning line from \`${branch}\`.`,
  });
}

/** What a reader sees in their pull request list: the plan this spec came from, cut to a line, or the branch when the run carries no title. The cap is the whole title's, prefix included — what fills a list is the line, not the part after the colon. */
function prTitle(branch: string, planTitle: string | undefined): string {
  const named = planTitle?.replace(/\s+/g, " ").trim();

  if (!named) {
    return `${TITLE_PREFIX}${branch}`;
  }
  const room = TITLE_MAX - TITLE_PREFIX.length;

  return `${TITLE_PREFIX}${named.length > room ? `${named.slice(0, room - 1)}\u2026` : named}`;
}

const TITLE_PREFIX = "spec: ";

// The cap the Floor's own spec-PR titles used, so a long plan title does not fill a reader's list.
const TITLE_MAX = 70;

/** The spec the plan's spec-tasks belong to rides the run's bag from here, so the stations after the merge read it rather than derive it again; a plan naming none produces none. */
function reported(prUrl: string, specPath: string | undefined): Report {
  return {
    outcome: "success",
    produced: { pr_url: prUrl, ...(specPath ? { spec_path: specPath } : {}) },
  };
}

export function startOpenSpecPrStation(): RunningStation {
  return defineStation("open-spec-pr", openSpecPrHandle(productionDeps));
}
