// Tags one repository's release on the external floor (specs/scheduled-releases): the agent only classifies the bump, so the version is computed here and the tag is made at the commit the run pinned. The same tag at the same commit is a visit retried.
import {
  defineStation,
  type Brief,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  parseBumpClassification,
  type BumpClassification,
} from "@re-cinq/lore-shared/release/bump-classification.js";
import {
  nextVersion,
  type Bump,
} from "@re-cinq/lore-shared/release/next-version.js";
import { tagDeps } from "../deps.js";

export interface ReleaseTagDeps {
  /** The commit the tag points to, null when there is no such tag. */
  tagSha(repo: string, tag: string): Promise<string | null>;
  createTag(repo: string, tag: string, sha: string): Promise<void>;
}

export const NOT_A_TAG_REQUEST =
  "the run carries no release to tag: release_repo and release_sha are both needed";

/** `changes_requested` when the agent's bump file is unreadable, so the line sends it back; no tag is made then. */
export function releaseTagHandle(deps: ReleaseTagDeps): Handle {
  return async (brief, tools) => {
    const request = tagRequestOf(brief);

    if (request === null) {
      return { outcome: "failed", error: NOT_A_TAG_REQUEST };
    }
    const bump = await bumpOf(tools);

    if (!bump.ok) {
      return { outcome: "changes_requested", error: bump.reason };
    }

    try {
      const produced = await tagRelease(deps, { ...request, ...bump });

      return { outcome: "success", produced };
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

interface TagRequest {
  repo: string;
  sha: string;
  previousTag: string | null;
}

type ReleaseToTag = TagRequest & { bump: Bump };

function tagRequestOf(brief: Brief): TagRequest | null {
  const { release_repo: repo, release_sha: sha } = brief.needs;

  return typeof repo === "string" && typeof sha === "string"
    ? { repo, sha, previousTag: previousTagOf(brief) }
    : null;
}

async function tagRelease(
  deps: ReleaseTagDeps,
  { repo, sha, previousTag, bump }: ReleaseToTag,
): Promise<Record<string, string>> {
  const version = nextVersion(previousTag, bump);

  await tagAt(deps, { repo, version, sha });

  return { release_version: version, release_bump_kind: bump };
}

async function bumpOf(tools: Tools): Promise<BumpClassification> {
  return parseBumpClassification(
    (await tools.read("release_bump")).toString("utf8"),
  );
}

function previousTagOf(brief: Brief): string | null {
  return "previous_tag" in brief.needs ? brief.needs.previous_tag : null;
}

/** Creates the tag; one already at the sha is a visit retried, one at another commit is refused. */
async function tagAt(
  deps: ReleaseTagDeps,
  { repo, version, sha }: { repo: string; version: string; sha: string },
): Promise<void> {
  const existing = await deps.tagSha(repo, version);

  enforceTrue(
    existing === null || existing === sha,
    Error,
    `tag ${version} already sits at ${existing}, not at ${sha}`,
  );

  if (existing === null) {
    await deps.createTag(repo, version, sha);
  }
}

export function startReleaseTagStation(): RunningStation {
  return defineStation("release-tag", releaseTagHandle(tagDeps()));
}
