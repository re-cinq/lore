// The composition root of the release stations: GitHub reads and the tag write.
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import { closedWorkSince } from "../outbound/closed-work.js";
import type { CommitAt, ReleaseCollectDeps } from "./collect/station.js";
import type { ReleaseTagDeps } from "./tag/station.js";

export function collectDeps(): ReleaseCollectDeps {
  const github = new PlatformGitHub(process.env);
  const commitAt = async (repo: string, ref: string): Promise<CommitAt> => {
    const [commit] = await github.listBranchCommits(repo, ref, 1);

    return { sha: commit.sha, committedAt: commit.date };
  };

  return {
    head: async (repo) => commitAt(repo, await github.getDefaultBranch(repo)),
    tags: (repo) => github.listTags(repo),
    commit: commitAt,
    closedWork: closedWorkSince,
  };
}

export function tagDeps(): ReleaseTagDeps {
  const github = new PlatformGitHub(process.env);

  return {
    tagSha: async (repo, tag) => {
      const tags = await github.listTags(repo);

      return tags.find((entry) => entry.name === tag)?.sha ?? null;
    },
    createTag: (repo, tag, sha) => github.createTagRef(repo, tag, sha),
  };
}
