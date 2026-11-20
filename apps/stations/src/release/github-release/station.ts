// Puts the release summary on the GitHub release of the release's tag on the external floor (specs/scheduled-releases): on the mirror when the release was published there, on the repository itself otherwise. A release the tag already has is completed rather than replaced, and a retried visit finds the summary there and writes nothing.
import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { errorMessage } from "@re-cinq/lore-shared";
import type { GitHubReleasePort } from "@re-cinq/lore-shared/project/lib/github-port.js";
import { githubReleaseDeps } from "../deps.js";
import { absentNeedsReport, optionalNeed } from "../needs.js";
import { releaseAction } from "./release-body.js";

export type ReleaseGitHubDeps = Pick<
  GitHubReleasePort,
  "createRelease" | "releaseByTag" | "updateRelease"
>;

const REQUIRED = [
  "release_repo",
  "release_version",
  "release_sha",
  "release_notes",
];

export function releaseGithubReleaseHandle(deps: ReleaseGitHubDeps): Handle {
  return async ({ needs }, tools) => {
    const absent = absentNeedsReport(needs, REQUIRED);

    if (absent) {
      return absent;
    }
    const target = optionalNeed(needs, "published_to") ?? needs.release_repo;
    const tag = needs.release_version;

    try {
      const summary = (await tools.read("release_notes"))
        .toString("utf8")
        .trim();
      const url = await putSummary(deps, { target, tag, summary });

      return { outcome: "success", produced: { release_url: url } };
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

async function putSummary(
  deps: ReleaseGitHubDeps,
  { target, tag, summary }: { target: string; tag: string; summary: string },
): Promise<string> {
  const action = releaseAction(await deps.releaseByTag(target, tag), summary);

  if (action.kind === "keep") {
    return action.url;
  }

  if (action.kind === "complete") {
    return (await deps.updateRelease(target, action.id, { body: action.body }))
      .url;
  }

  return (
    await deps.createRelease(target, { tag, name: tag, body: action.body })
  ).url;
}

export function startReleaseGithubReleaseStation(): RunningStation {
  return defineStation(
    "release-github-release",
    releaseGithubReleaseHandle(githubReleaseDeps()),
  );
}
