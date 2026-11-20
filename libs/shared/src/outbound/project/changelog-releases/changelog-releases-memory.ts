import type { ChangelogRelease } from "../../../domain/models/changelog-release.js";
import {
  type ChangelogReleasePageQuery,
  type ChangelogReleasesPort,
  latestRelease,
  type ChangelogReleaseWrite,
} from "./changelog-releases-port.js";

export class InMemoryChangelogReleases implements ChangelogReleasesPort {
  readonly rows: ChangelogRelease[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async upsert(release: ChangelogReleaseWrite): Promise<void> {
    const existing = this.find(release.repo, release.version);

    if (existing) {
      Object.assign(existing, release);

      return;
    }
    this.rows.push({
      ...release,
      announcedAt: null,
      slackTs: null,
      writtenAt: this.now(),
    });
  }

  async page(
    repo: string,
    { before, limit }: ChangelogReleasePageQuery,
  ): Promise<ChangelogRelease[]> {
    return this.rows
      .filter((row) => row.repo === repo)
      .filter((row) => before === undefined || row.rangeTo < before)
      .sort(
        (a, b) =>
          b.rangeTo.getTime() - a.rangeTo.getTime() ||
          Number(b.version > a.version) - Number(b.version < a.version),
      )
      .slice(0, limit);
  }

  async latest(repo: string): Promise<ChangelogRelease | null> {
    return latestRelease(this, repo);
  }

  async claimAnnouncement(repo: string, version: string): Promise<boolean> {
    const release = this.find(repo, version);

    if (!release || release.announcedAt) {
      return false;
    }
    release.announcedAt = this.now();

    return true;
  }

  private find(repo: string, version: string): ChangelogRelease | undefined {
    return this.rows.find(
      (row) => row.repo === repo && row.version === version,
    );
  }
}
