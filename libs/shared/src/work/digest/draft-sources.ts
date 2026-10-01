// Where a digest draft's facts come from, bound once per process: GitHub for what merged, closed and is open, and Slack's directory for who a GitHub login is. The lookups that rarely change are remembered for a day; the manual override is read fresh so an edit on the settings page applies to the next digest.
import type { Project } from "../../outbound/project/lib/project.js";
import type { DigestRepo } from "./codec.js";
import { parseSlackUsers, resolveNames } from "./people.js";
import type { DraftDeps, RepoChanges } from "./serve-draft.js";
import { ttlMemo } from "./ttl-memo.js";

/** The slice of a repo's Project the draft reads. */
export type DigestRepoReads = Pick<Project, "pulls" | "issues" | "repo">;

export interface DraftSourceIo {
  project(repo: string): Promise<DigestRepoReads>;
  /** The org setting `slack_users`, raw; null when unset. */
  slackUsersSetting(): Promise<string | null>;
  directory: {
    idByEmail(email: string): Promise<string | null>;
    displayName(id: string): Promise<string | null>;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function digestDraftSources(
  io: DraftSourceIo,
): Pick<DraftDeps, "collect" | "namesFor"> {
  const slackIdByEmail = ttlMemo(
    (email: string) => io.directory.idByEmail(email),
    DAY_MS,
  );
  const slackName = ttlMemo(
    (id: string) => io.directory.displayName(id),
    DAY_MS,
  );
  const commitEmail = ttlMemo(async (repoAndLogin: string) => {
    const [repo, login] = repoAndLogin.split(" ");

    return (await io.project(repo)).repo.commitEmailOf(login);
  }, DAY_MS);

  return {
    collect: (entry) => collectChanges(io, entry),
    namesFor: async (repo, logins) =>
      resolveNames(logins, {
        override: parseSlackUsers((await io.slackUsersSetting()) ?? undefined),
        emailOf: (login) => commitEmail(`${repo} ${login}`),
        slackIdByEmail,
        slackName,
      }),
  };
}

/** The three GitHub reads of one repo's window, in parallel. */
async function collectChanges(
  io: DraftSourceIo,
  entry: DigestRepo,
): Promise<RepoChanges> {
  const project = await io.project(entry.repo);
  const [merged, closed, open] = await Promise.all([
    project.pulls.listMergedSince(entry.since),
    project.issues.list({ state: "closed", since: entry.since }),
    project.issues.list({ state: "open" }),
  ]);

  return { merged, closed, open };
}
