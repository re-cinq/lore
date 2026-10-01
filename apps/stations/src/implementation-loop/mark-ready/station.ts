// Hands a finished ticket's pull request to its reviewers: the title and description the ready-for-review agent wrote replace the ones the draft opened under, and the pull request leaves draft, which is what starts the code review.

import {
  defineStation,
  type Brief,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { clampPrTitle, prFooter } from "@re-cinq/lore-shared";
import { parsePullRequestUrl } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import { projectFor } from "../../outbound/project-boot.js";

export interface MarkReadyPulls {
  update(
    number: number,
    fields: { title?: string; body?: string },
  ): Promise<void>;
  markReady(number: number): Promise<void>;
}

export interface MarkReadyDeps {
  pulls(repo: string): Promise<MarkReadyPulls>;
}

const productionDeps: MarkReadyDeps = {
  pulls: async (repo) => (await projectFor(repo)).pulls,
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
      const rewrite = rewriteOf(ready, await proseOf(brief, tools));

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

async function proseOf(brief: Brief, tools: Tools): Promise<string> {
  return BODY in brief.needs
    ? (await tools.read(BODY)).toString("utf8").trim()
    : "";
}

/** The fields to rewrite. The footer is rebuilt with the description, because rewriting a body with prose alone would drop the `Closes` and `Lore-Task` lines the draft opened with. */
function rewriteOf(
  ready: ReadyNeeds,
  prose: string,
): { title?: string; body?: string } {
  const title = ready.pr_title?.trim();

  return {
    ...(title ? { title: clampPrTitle(title) } : {}),
    ...(prose ? { body: prose + footerOf(ready) } : {}),
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
