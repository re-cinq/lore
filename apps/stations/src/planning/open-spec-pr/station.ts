// Opens (or finds) the pull request carrying what spec-write pushed, the same direct-GitHub-write shape the review family's own stations use (see specs/external-floor/spec.md FR8.6).

import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
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
  return async (brief) => {
    const { repo, branch } = parseGitRef(brief.needs.target);

    try {
      const project = await deps.project(repo);
      const pr = await ensurePr(project.pulls, branch, brief.needs.plan_title);

      return reported(pr.url);
    } catch (err) {
      return { outcome: "failed", error: (err as Error).message };
    }
  };
}

async function ensurePr(
  pulls: OpenSpecPrProject["pulls"],
  branch: string,
  planTitle: string | undefined,
): Promise<PullRef> {
  return (
    (await existingPrFor(pulls, branch)) ??
    (await pulls.open(branch, {
      title: prTitle(branch, planTitle),
      body: `Opened by the Lore feature-planning line from \`${branch}\`.`,
    }))
  );
}

/** What a reader sees in their pull request list: the plan this spec came from, cut to a line, or the branch when the run carries no title. */
function prTitle(branch: string, planTitle: string | undefined): string {
  const named = planTitle?.replace(/\s+/g, " ").trim();

  if (!named) {
    return `spec: ${branch}`;
  }

  return `spec: ${named.length > TITLE_MAX ? `${named.slice(0, TITLE_MAX - 1)}\u2026` : named}`;
}

// The cap the Floor's own spec-PR titles used, so a long plan title does not fill a reader's list.
const TITLE_MAX = 70;

/** Finds the open PR already on this branch, so a re-dispatch of this node never forks review across two PRs. */
async function existingPrFor(
  pulls: OpenSpecPrProject["pulls"],
  branch: string,
): Promise<PullRef | null> {
  const open = await pulls.list();

  return open.find((pr) => pr.branch === branch) ?? null;
}

function reported(prUrl: string): Report {
  return { outcome: "success", produced: { pr_url: prUrl } };
}

export function startOpenSpecPrStation(): RunningStation {
  return defineStation("open-spec-pr", openSpecPrHandle(productionDeps));
}
