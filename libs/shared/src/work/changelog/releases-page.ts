import type { ChangelogChange } from "../../domain/models/changelog-week.js";
import type { ChangelogRelease } from "../../domain/models/changelog-release.js";
import {
  releaseEnabled,
  type ReleaseSettings,
} from "../../domain/release-settings.js";
import { releaseChanges } from "../release/release-changes.js";
import type { ClosedWork } from "./changelog-week.js";

/** One page of a repository's Changelog tab once it has releases (specs/repo-changelog FR7): stored releases newest first, and on the first page what merged and closed since the latest one, read live from GitHub. */

const BEGINNING = new Date(0).toISOString();

export interface PageRelease {
  version: string;
  previousTag: string | null;
  bump: ChangelogRelease["bump"];
  /** Null for the first release, which reaches back to the beginning. */
  from: string | null;
  to: string;
  summary: string;
  changes: ChangelogChange[];
  releaseUrl: string | null;
  publishedTo: string | null;
}

export interface Unreleased {
  /** Null when the repository has no release yet. */
  latestVersion: string | null;
  /** The latest release's `to`; null when there is none. */
  since: string | null;
  changes: ChangelogChange[];
}

export interface ReleasesPage {
  mode: "releases";
  /** Always empty: the weeks of a repository without releases. */
  weeks: [];
  releases: PageRelease[];
  /** Only on the first page. */
  unreleased: Unreleased | null;
  /** The `before` of the next page, the `to` of the last release; null when this page was not full. */
  next: string | null;
}

export interface ReleasesPageDeps {
  now(): Date;
  /** The repository's stored releases, newest first. */
  stored(query: { before?: Date; limit: number }): Promise<ChangelogRelease[]>;
  /** What merged and closed in the repository since `since`. */
  closedWork(since: string): Promise<ClosedWork>;
}

/** A repository lists releases once its schedule is on or one is stored; any other keeps its weeks. */
export function hasReleases(
  settings:
    | { release?: ReleaseSettings | null; [key: string]: unknown }
    | null
    | undefined,
  latest: ChangelogRelease | null,
): boolean {
  return releaseEnabled(settings) || latest !== null;
}

export async function releasesPage(
  query: { before?: string; limit: number },
  deps: ReleasesPageDeps,
): Promise<ReleasesPage> {
  const stored = await deps.stored({
    before: query.before === undefined ? undefined : new Date(query.before),
    limit: query.limit,
  });
  const releases = stored.map(pageRelease);

  return {
    mode: "releases",
    weeks: [],
    releases,
    unreleased:
      query.before === undefined ? await unreleased(stored.at(0), deps) : null,
    next:
      releases.length === query.limit ? (releases.at(-1)?.to ?? null) : null,
  };
}

async function unreleased(
  latest: ChangelogRelease | undefined,
  deps: ReleasesPageDeps,
): Promise<Unreleased> {
  const since = latest?.rangeTo.toISOString() ?? null;
  const work = await deps.closedWork(since ?? BEGINNING);

  return {
    latestVersion: latest?.version ?? null,
    since,
    changes: releaseChanges(work, {
      since,
      until: deps.now().toISOString(),
    }),
  };
}

function pageRelease(release: ChangelogRelease): PageRelease {
  return {
    version: release.version,
    previousTag: release.previousTag,
    bump: release.bump,
    from: release.rangeFrom?.toISOString() ?? null,
    to: release.rangeTo.toISOString(),
    summary: release.summary,
    changes: release.changes,
    releaseUrl: release.releaseUrl,
    publishedTo: release.publishedTo,
  };
}
