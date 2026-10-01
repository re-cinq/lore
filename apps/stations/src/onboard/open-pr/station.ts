// Opens (or finds) the one pull request an onboarding produces and records it on the repository, which is what the onboard guard and the merge-check sweep read. A branch with nothing on it is a setup that is already current: no pull request, and the run ends there.

import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import { prFooter } from "@re-cinq/lore-shared";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { projectFor } from "../../outbound/project-boot.js";
import { settings } from "../../outbound/queues.js";

export interface OpenOnboardPrDeps {
  listOpen(repo: string): Promise<PullRef[]>;
  open(
    repo: string,
    branch: string,
    pr: { title: string; body: string },
  ): Promise<PullRef>;
  recordOnboardingPr(repo: string, url: string): Promise<void>;
}

const productionDeps: OpenOnboardPrDeps = {
  listOpen: async (repo) => (await projectFor(repo)).pulls.list(),
  open: async (repo, branch, pr) => (await projectFor(repo)).pulls.open(branch, pr),
  recordOnboardingPr: (repo, url) => settings().setOnboardingPrUrl(repo, url),
};

const SUMMARY =
  "Onboards this repository to Lore: the workflows and templates Lore keeps current, and the repository-specific files written from the onboarding ticket.";

/** GitHub's refusal to open a pull request from a branch that holds nothing its base lacks. */
const NOTHING_TO_OPEN = /no commits between/i;

const ALREADY_CURRENT: Report = { outcome: "changes_requested" };

interface Onboarding {
  repo: string;
  branch: string;
  taskId: string;
  attention: string;
}

export function openOnboardPrHandle(deps: OpenOnboardPrDeps): Handle {
  return async ({ needs }) => {
    const onboarding = {
      ...parseGitRef(needs.target),
      taskId: needs.task_id,
      attention: needs.attention ?? "",
    };

    try {
      return await opened(deps, onboarding);
    } catch (err) {
      return NOTHING_TO_OPEN.test(errorMessage(err))
        ? ALREADY_CURRENT
        : { outcome: "failed", error: errorMessage(err) };
    }
  };
}

async function opened(
  deps: OpenOnboardPrDeps,
  onboarding: Onboarding,
): Promise<Report> {
  const { repo, branch } = onboarding;
  const open = await deps.listOpen(repo);
  const pr =
    open.find((candidate) => candidate.branch === branch) ??
    (await deps.open(repo, branch, {
      title: `lore: onboard ${repo}`,
      body: prBody(onboarding),
    }));

  await deps.recordOnboardingPr(repo, pr.url);

  return { outcome: "success", produced: { pr_url: pr.url } };
}

function prBody({ attention, taskId }: Onboarding): string {
  const sections = [SUMMARY, attention].filter((section) => section !== "");

  return sections.join("\n\n") + prFooter({ taskId });
}

export function startOpenOnboardPrStation(): RunningStation {
  return defineStation("onboard-open-pr", openOnboardPrHandle(productionDeps));
}
