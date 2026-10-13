// Hands a finished ticket's pull request to its reviewers: the title and description the ready-for-review agent wrote replace the ones the draft opened under, completed with any section of the repository's template the agent left out, and the pull request leaves draft, which is what starts the code review.

import {
  type Brief,
  defineStation,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { clampPrTitle, prFooter } from "@re-cinq/lore-shared";
import { parsePullRequestUrl } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import { optionalNeedText } from "../../domain/need-text.js";
import { projectFor } from "../../outbound/project-boot.js";
import {
  PR_TEMPLATE_PATH,
  requiredSections,
  withSections,
} from "../pr-sections.js";

export interface MarkReadyPulls {
  update(
    number: number,
    fields: { title?: string; body?: string },
  ): Promise<void>;
  markReady(number: number): Promise<void>;
}

export interface MarkReadyDeps {
  pulls(repo: string): Promise<MarkReadyPulls>;
  /** The repository's pull request template on its default branch, or null when it has none. */
  template(repo: string): Promise<string | null>;
}

const productionDeps: MarkReadyDeps = {
  pulls: async (repo) => (await projectFor(repo)).pulls,
  template: async (repo) =>
    (await projectFor(repo)).repo.read(PR_TEMPLATE_PATH),
};

const BODY = "pr_body";

/** What the agent may have written; each is absent when it wrote none. */
type ReadyNeeds = Partial<
  Record<"pr_body" | "pr_title" | "issue_number" | "issue_coverage", string>
> & { pr_url: string; task_id: string };

export function markReadyHandle(deps: MarkReadyDeps): Handle {
  return async (brief, tools) => {
    const ready = brief.needs as ReadyNeeds;
    const { repo, prNumber } = parsePullRequestUrl(ready.pr_url);

    try {
      const pulls = await deps.pulls(repo);
      const rewrite = await rewriteFor(deps, repo, brief.needs, tools);

      if (Object.keys(rewrite).length > 0) {
        await pulls.update(prNumber, rewrite);
      }
      await pulls.markReady(prNumber);

      return { outcome: "success" };
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

/** What the agent wrote, read from the bag, against the repository's template. */
async function rewriteFor(
  deps: MarkReadyDeps,
  repo: string,
  needs: Brief["needs"],
  tools: Tools,
): Promise<{ title?: string; body?: string }> {
  const [prose, template] = await Promise.all([
    optionalNeedText(needs, tools, BODY),
    deps.template(repo),
  ]);

  return rewriteOf(needs as ReadyNeeds, prose, template);
}

/** The fields to rewrite. The description is completed with the template's sections it lacks, and the footer is rebuilt with it, because rewriting a body with prose alone would drop the `Closes` and `Lore-Task` lines the draft opened with. */
function rewriteOf(
  ready: ReadyNeeds,
  prose: string,
  template: string | null,
): { title?: string; body?: string } {
  const title = ready.pr_title?.trim();

  return {
    ...(title ? { title: clampPrTitle(title) } : {}),
    ...(prose
      ? {
          body:
            withSections(prose, requiredSections(template)) + footerOf(ready),
        }
      : {}),
  };
}

function footerOf(ready: ReadyNeeds): string {
  return prFooter({
    issueNumber: Number(ready.issue_number) || null,
    taskId: ready.task_id,
    coverage: ready.issue_coverage === "partial" ? "partial" : "full",
  });
}

export function startMarkReadyStation(): RunningStation {
  return defineStation("loop-mark-ready", markReadyHandle(productionDeps));
}
