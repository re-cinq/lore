import type { ChangelogChange } from "@re-cinq/lore-shared/models/changelog-week.js";
import type { TagEntry } from "@re-cinq/lore-shared/utopia/release-text.js";
import { latestVersionTag } from "@re-cinq/lore-shared/release/next-version.js";

export interface ReleaseRange {
  previousTag: string | null;
  /** Exclusive; null reaches back to the beginning. */
  rangeFrom: string | null;
  rangeTo: string;
}

export function previousRelease(tags: TagEntry[]): TagEntry | null {
  const name = latestVersionTag(tags.map((tag) => tag.name));

  return tags.find((tag) => tag.name === name) ?? null;
}

/** The values the later stations need; a first release has no previous tag and no start. */
export function releaseValues(
  release: ReleaseRange & { sha: string },
): Record<string, string> {
  return {
    release_sha: release.sha,
    ...(release.previousTag ? { previous_tag: release.previousTag } : {}),
    ...(release.rangeFrom ? { range_from: isoOf(release.rangeFrom) } : {}),
    range_to: isoOf(release.rangeTo),
  };
}

export function releaseFile(
  release: ReleaseRange & {
    repo: string;
    sha: string;
    changes: ChangelogChange[];
  },
): string {
  return JSON.stringify({
    repo: release.repo,
    previous_tag: release.previousTag,
    sha: release.sha,
    range_from: release.rangeFrom && isoOf(release.rangeFrom),
    range_to: isoOf(release.rangeTo),
    changes: release.changes,
  });
}

function isoOf(instant: string): string {
  return new Date(instant).toISOString();
}
