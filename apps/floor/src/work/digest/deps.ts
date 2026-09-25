// The composition root of the digest's Floor side: the queue singletons, per-repo Projects and the Slack poster, bound once here so the routes and the run-closed hook share one wiring (and a test replaces one module).

import { SlackPosterHttp } from "@re-cinq/lore-shared/project/notify/slack-poster-http.js";
import { SlackDirectoryHttp } from "@re-cinq/lore-shared/project/notify/slack-directory-http.js";
import {
  parseSlackUsers,
  resolveNames,
  type SlackUsers,
} from "@re-cinq/lore-shared/digest/people.js";
import { query } from "../../outbound/db.js";
import { ttlMemo } from "./ttl-memo.js";
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
    namesFor,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const directory = new SlackDirectoryHttp(process.env);
const slackIdByEmail = ttlMemo((email) => directory.idByEmail(email), DAY_MS);
const slackName = ttlMemo((id) => directory.displayName(id), DAY_MS);
const commitEmail = ttlMemo(async (repoAndLogin) => {
  const [repo, login] = repoAndLogin.split(" ");

  return (await projectFor(repo)).repo.commitEmailOf(login);
}, DAY_MS);

/** The manual override is read fresh each time, so an edit on the settings page applies to the next digest. */
async function namesFor(
  repo: string,
  logins: string[],
): Promise<Record<string, string>> {
  return resolveNames(logins, {
    override: await slackUsersOverride(),
    emailOf: (login) => commitEmail(`${repo} ${login}`),
    slackIdByEmail,
    slackName,
  });
}

async function slackUsersOverride(): Promise<SlackUsers> {
  const rows = await query<{ value: string }>(
    "SELECT value FROM lore.settings WHERE key = 'slack_users'",
  );

  return parseSlackUsers(rows[0]?.value);
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
