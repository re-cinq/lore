// The composition root of the digest's Floor side: the queue singletons, per-repo Projects and the Slack poster, bound once here so the routes and the run-closed hook share one wiring (and a test replaces one module).

import { SlackPosterHttp } from "@re-cinq/lore-shared/project/notify/slack-poster-http.js";
import { SlackDirectoryHttp } from "@re-cinq/lore-shared/project/notify/slack-directory-http.js";
import { digestDraftSources } from "@re-cinq/lore-shared/digest/draft-sources.js";
import type { DraftDeps } from "@re-cinq/lore-shared/digest/serve-draft.js";
import type { UploadDeps } from "@re-cinq/lore-shared/digest/deliver-digest.js";
import { pipeline, settings } from "../../outbound/queues.js";
import { projectFor } from "../../outbound/project-boot.js";

const sources = digestDraftSources({
  project: projectFor,
  slackUsersSetting: () => settings().orgSetting("slack_users"),
  directory: new SlackDirectoryHttp(process.env),
});

export function draftDeps(): DraftDeps {
  return {
    runById: (runId) => pipeline().assemblyRuns.getById(runId),
    mergeArgs: (runId, patch) =>
      pipeline().assemblyRuns.mergeArgs(runId, patch),
    recentTexts: (channel, limit) =>
      pipeline().digestPosts.recentTexts(channel, limit),
    ...sources,
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
