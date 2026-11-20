import type { ChangelogRelease } from "../../../domain/models/changelog-release.js";

export type ChangelogReleaseWrite = Omit<
  ChangelogRelease,
  "announcedAt" | "slackTs" | "writtenAt"
>;

export interface ChangelogReleasePageQuery {
  before?: Date;
  limit: number;
}

export interface ChangelogReleasesPort {
  upsert(release: ChangelogReleaseWrite): Promise<void>;
  page(
    repo: string,
    query: ChangelogReleasePageQuery,
  ): Promise<ChangelogRelease[]>;
  latest(repo: string): Promise<ChangelogRelease | null>;
  claimAnnouncement(repo: string, version: string): Promise<boolean>;
}

export async function latestRelease(
  port: ChangelogReleasesPort,
  repo: string,
): Promise<ChangelogRelease | null> {
  const newest = await port.page(repo, { limit: 1 });

  return newest.at(0) ?? null;
}
