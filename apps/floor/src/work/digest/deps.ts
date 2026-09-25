// The composition root of the digest's Floor side: the queue singletons, per-repo Projects and the Slack poster, bound once here so the routes and the run-closed hook share one wiring (and a test replaces one module).

import { SlackPosterHttp } from "@re-cinq/lore-shared/project/notify/slack-poster-http.js";
import type { DigestRepo } from "@re-cinq/lore-shared/digest/codec.js";
import { pipeline } from "../../outbound/queues.js";
import { projectFor } from "../../outbound/project-boot.js";
import type { DraftDeps, RepoChanges } from "./serve-draft.js";
import type { UploadDeps } from "./deliver-digest.js";

export function draftDeps(): DraftDeps {
  return {
    runById: (runId) => pipeline().assemblyRuns.getById(runId),
    mergeArgs: (runId, patch) =>
      pipeline().assemblyRuns.mergeArgs(runId, patch),
    recentTexts: (channel, limit) =>
      pipeline().digestPosts.recentTexts(channel, limit),
    collect: collectChanges,
  };
}

export function uploadDeps(): UploadDeps {
  return {
    posts: pipeline().digestPosts,
    poster: new SlackPosterHttp(process.env),
    runOfAgent: async (agentCrName) => {
      const visit =
        await pipeline().assemblyRuns.findStationRunByAgentCrName(agentCrName);

      return visit
        ? pipeline().assemblyRuns.getById(visit.assemblyRunId)
        : null;
    },
  };
}

/** The three GitHub reads of one repo's window, in parallel. */
async function collectChanges(entry: DigestRepo): Promise<RepoChanges> {
  const project = await projectFor(entry.repo);
  const [merged, closed, open] = await Promise.all([
    project.pulls.listMergedSince(entry.since),
    project.issues.list({ state: "closed", since: entry.since }),
    project.issues.list({ state: "open" }),
  ]);

  return { merged, closed, open };
}
