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
import {
  ensurePull,
  type PullOpener,
} from "@re-cinq/lore-shared/project/pulls/ensure-pull.js";
import { projectFor } from "../../outbound/project-boot.js";
import { settings } from "../../outbound/queues.js";

export interface OpenOnboardPrDeps {
  pulls(repo: string): Promise<PullOpener>;
  recordOnboardingPr(repo: string, url: string): Promise<void>;
}

const productionDeps: OpenOnboardPrDeps = {
  pulls: async (repo) => (await projectFor(repo)).pulls,
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
    const onboarding = onboardingOf(needs);

    try {
      return await opened(deps, onboarding);
    } catch (err) {
      return NOTHING_TO_OPEN.test(errorMessage(err))
        ? ALREADY_CURRENT
        : { outcome: "failed", error: errorMessage(err) };
    }
  };
}

function onboardingOf(needs: Record<string, string>): Onboarding {
  return {
    ...parseGitRef(needs.target),
    taskId: needs.task_id,
    attention: attentionOf(needs),
  };
}

/** `attention` is an optional need, so a brief may carry none. */
function attentionOf(needs: Partial<Record<string, string>>): string {
  return needs.attention ?? "";
}

async function opened(
  deps: OpenOnboardPrDeps,
  onboarding: Onboarding,
): Promise<Report> {
  const { repo, branch } = onboarding;
  const pr = await ensurePull(await deps.pulls(repo), branch, {
    title: `lore: onboard ${repo}`,
    body: prBody(onboarding),
  });

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
