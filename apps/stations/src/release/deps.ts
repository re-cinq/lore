// The composition root of the release stations: GitHub reads, the tag and release writes, the mirror push, the release store and Slack.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SlackPosterHttp } from "@re-cinq/lore-shared/project/notify/slack-poster-http.js";
import { GitMirrorPush } from "@re-cinq/lore-shared/project/workspace/mirror-push-git.js";
import type { ChangelogReleasesPort } from "@re-cinq/lore-shared/project/changelog-releases/changelog-releases-port.js";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import { syncMirror } from "../outbound/mirror-sync.js";
import { closedWorkSince } from "../outbound/closed-work.js";
import type { CommitAt, ReleaseCollectDeps } from "./collect/station.js";
import type { ReleaseTagDeps } from "./tag/station.js";
import { pipeline, settings } from "../outbound/queues.js";
import type { ReleaseAnnounceDeps } from "./announce/station.js";
import type { ReleaseGitHubDeps } from "./github-release/station.js";
import type { ReleasePublishDeps } from "./publish/station.js";

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

/** One bare clone per source repository under the OS temp dir, which on the stations pod is disk-backed, so the next release fetches rather than clones. */
export function mirrorCacheDir(repo: string): string {
  return join(tmpdir(), "lore-release-mirror", repo.replace("/", "__"));
}

export function publishDeps(): ReleasePublishDeps {
  const github = new PlatformGitHub(process.env);

  return {
    settings: settings(),
    releases: github,
    mintToken: (repo, permissions) =>
      github.getInstallationToken(repo, permissions),
    mirrorPush: (repo) => new GitMirrorPush(mirrorCacheDir(repo), process.env),
    syncMirror,
  };
}

export function githubReleaseDeps(): ReleaseGitHubDeps {
  return new PlatformGitHub(process.env);
}

/** Called when the stations start, after the pool exists. */
export function storeDeps(): ChangelogReleasesPort {
  return pipeline().changelogReleases;
}

export function announceDeps(): ReleaseAnnounceDeps {
  return {
    settings: settings(),
    releases: pipeline().changelogReleases,
    poster: new SlackPosterHttp(process.env),
  };
}
