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
  /** Records that the repo's schedule started a release run at `at`, replacing the earlier mark. */
  markScheduledAttempt(repo: string, at: Date): Promise<void>;
  /** When the repo's schedule last started a release run, null when it never did. */
  lastScheduledAttempt(repo: string): Promise<Date | null>;
}

export async function latestRelease(
  port: ChangelogReleasesPort,
  repo: string,
): Promise<ChangelogRelease | null> {
  const newest = await port.page(repo, { limit: 1 });

  return newest.at(0) ?? null;
}
