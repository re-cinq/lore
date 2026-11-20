import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";
import { ChangelogChangeSchema } from "./changelog-week.js";

export const CHANGELOG_RELEASE_BUMPS = ["major", "minor", "patch"] as const;

export const ChangelogReleaseSchema = z.object({
  repo: z.string(),
  version: z.string(),
  previousTag: z.string().nullable(),
  sha: z.string(),
  bump: z.enum(CHANGELOG_RELEASE_BUMPS),
  rangeFrom: z.date().nullable(),
  rangeTo: z.date(),
  summary: z.string(),
  changes: z.array(ChangelogChangeSchema),
  releaseUrl: z.string().nullable(),
  publishedTo: z.string().nullable(),
  announcedAt: z.date().nullable(),
  slackTs: z.string().nullable(),
  writtenAt: z.date(),
});

export type ChangelogRelease = z.infer<typeof ChangelogReleaseSchema>;

export const CHANGELOG_RELEASE_COLUMNS = {
  repo: "repo",
  version: "version",
  previousTag: "previous_tag",
  sha: "sha",
  bump: "bump",
  rangeFrom: "range_from",
  rangeTo: "range_to",
  summary: "summary",
  changes: "changes",
  releaseUrl: "release_url",
  publishedTo: "published_to",
  announcedAt: "announced_at",
  slackTs: "slack_ts",
  writtenAt: "written_at",
} as const satisfies ColumnMap<ChangelogRelease>;

export const CHANGELOG_RELEASE_TABLE = "lore.changelog_releases";
