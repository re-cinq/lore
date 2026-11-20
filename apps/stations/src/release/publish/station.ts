// Publishes one repository's pinned release to its public mirror on the external floor (specs/scheduled-releases): the mirror's main is fast-forwarded to the release sha and the tag made there in one push, never forced. A repository with no mirror releases on itself, so the station succeeds and produces nothing.
import {
  defineStation,
  type Brief,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import { errorMessage } from "@re-cinq/lore-shared";
import type { GitHubReleasePort } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { SettingsPort } from "@re-cinq/lore-shared/project/settings/settings-port.js";
import {
  gitAuthArgs,
  repoCloneUrl,
} from "@re-cinq/lore-shared/project/workspace/git-auth.js";
import type {
  MirrorPushOutcome,
  MirrorPushPort,
} from "@re-cinq/lore-shared/project/workspace/mirror-push-port.js";
import { publishDeps } from "../deps.js";
import { absentNeedsReport } from "../needs.js";
import {
  failureReport,
  mirrorOf,
  mirrorStatusReport,
  publishReport,
  type PublishedRelease,
} from "./publish-report.js";

export type TokenPermissions = Record<string, "read" | "write">;

export interface ReleasePublishDeps {
  settings: Pick<SettingsPort, "rawSettings">;
  releases: Pick<GitHubReleasePort, "repoVariable">;
  /** A fresh installation token for the repository, carrying only the permissions asked. */
  mintToken(repo: string, permissions: TokenPermissions): Promise<string>;
  /** The mirror push whose clone is cached for this source repository. */
  mirrorPush(repo: string): MirrorPushPort;
}

const REQUIRED = ["release_repo", "release_sha", "release_version"];
const SOURCE_PERMISSIONS: TokenPermissions = { contents: "read" };
const MIRROR_PERMISSIONS: TokenPermissions = {
  contents: "write",
  workflows: "write",
};

export function releasePublishHandle(deps: ReleasePublishDeps): Handle {
  return async ({ needs }) =>
    absentNeedsReport(needs, REQUIRED) ?? (await publish(deps, needs));
}

async function publish(
  deps: ReleasePublishDeps,
  needs: Brief["needs"],
): Promise<Report> {
  const {
    release_repo: repo,
    release_sha: sha,
    release_version: version,
  } = needs;

  try {
    const mirror = mirrorOf(await deps.settings.rawSettings(repo));

    return mirror === null
      ? { outcome: "success" }
      : await publishTo(deps, { repo, mirror, sha, version });
  } catch (err) {
    return { outcome: "failed", error: errorMessage(err) };
  }
}

async function publishTo(
  deps: ReleasePublishDeps,
  release: PublishedRelease,
): Promise<Report> {
  try {
    const switchedOff = mirrorStatusReport(
      release.mirror,
      await deps.releases.repoVariable(release.mirror, "LORE_MIRROR"),
    );

    return (
      switchedOff ?? publishReport(await pushToMirror(deps, release), release)
    );
  } catch (err) {
    return failureReport(err, release.mirror);
  }
}

async function pushToMirror(
  deps: ReleasePublishDeps,
  { repo, mirror, sha, version }: PublishedRelease,
): Promise<MirrorPushOutcome> {
  const [sourceToken, mirrorToken] = await Promise.all([
    deps.mintToken(repo, SOURCE_PERMISSIONS),
    deps.mintToken(mirror, MIRROR_PERMISSIONS),
  ]);

  return deps.mirrorPush(repo).push({
    sourceUrl: repoCloneUrl(repo),
    sourceAuthArgs: gitAuthArgs(sourceToken),
    targetUrl: repoCloneUrl(mirror),
    targetAuthArgs: gitAuthArgs(mirrorToken),
    sha,
    tag: version,
  });
}

export function startReleasePublishStation(): RunningStation {
  return defineStation("release-publish", releasePublishHandle(publishDeps()));
}
