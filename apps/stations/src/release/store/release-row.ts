import { z } from "zod";
import { ChangelogChangeSchema } from "@re-cinq/lore-shared/models/changelog-week.js";
import { CHANGELOG_RELEASE_BUMPS } from "@re-cinq/lore-shared/models/changelog-release.js";
import type { ChangelogReleaseWrite } from "@re-cinq/lore-shared/project/changelog-releases/changelog-releases-port.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { optionalNeed } from "../needs.js";

const ReleaseChangesFile = z.object({
  changes: z.array(ChangelogChangeSchema),
});

/** The row of the release store from the run's values and the two files; a bump kind that is not major, minor or patch is refused rather than stored. */
export function releaseRow(
  needs: Record<string, string>,
  { changesFile, notes }: { changesFile: string; notes: string },
): ChangelogReleaseWrite {
  const rangeFrom = optionalNeed(needs, "range_from");

  return {
    repo: needs.release_repo,
    version: needs.release_version,
    previousTag: optionalNeed(needs, "previous_tag"),
    sha: needs.release_sha,
    bump: bumpOf(needs.release_bump_kind),
    rangeFrom: rangeFrom === null ? null : new Date(rangeFrom),
    rangeTo: new Date(needs.range_to),
    summary: notes.trim(),
    changes: ReleaseChangesFile.parse(JSON.parse(changesFile)).changes,
    releaseUrl: optionalNeed(needs, "release_url"),
    publishedTo: optionalNeed(needs, "published_to"),
  };
}

function bumpOf(kind: string): ChangelogReleaseWrite["bump"] {
  const bump = CHANGELOG_RELEASE_BUMPS.find((known) => known === kind);

  enforceTrue(
    bump,
    Error,
    `release_bump_kind ${kind} is not major, minor or patch`,
  );

  return bump;
}
