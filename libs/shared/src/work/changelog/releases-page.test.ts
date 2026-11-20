import { describe, it, expect } from "vitest";
import { mergedPr } from "../digest/fixtures.js";
import type { ChangelogRelease } from "../../domain/models/changelog-release.js";
import {
  hasReleases,
  releasesPage,
  type ReleasesPageDeps,
} from "./releases-page.js";

const THURSDAY_W43 = new Date("2026-10-22T12:00:00Z");

function release(version: string, rangeTo: string): ChangelogRelease {
  return {
    repo: "re-cinq/lore",
    version,
    previousTag: null,
    sha: "abc123",
    bump: "minor",
    rangeFrom: null,
    rangeTo: new Date(rangeTo),
    summary: `Summary of ${version}`,
    changes: [],
    releaseUrl: null,
    publishedTo: "re-cinq/lore-public",
    announcedAt: null,
    slackTs: null,
    writtenAt: new Date(rangeTo),
  };
}

function deps(stored: ChangelogRelease[]) {
  const asked: unknown[] = [];
  const all: ReleasesPageDeps = {
    now: () => THURSDAY_W43,
    stored: (query) => {
      asked.push({ stored: query });

      return Promise.resolve(
        stored.filter((row) => !query.before || row.rangeTo < query.before),
      );
    },
    closedWork: (since) => {
      asked.push({ since });

      return Promise.resolve({
        merged: [
          mergedPr({ number: 3055, mergedAt: "2026-10-21T10:00:00Z" }),
          mergedPr({ number: 3000, mergedAt: "2026-10-10T10:00:00Z" }),
        ],
        closed: [],
      });
    },
  };

  return { all, asked };
}

describe("hasReleases", () => {
  it("is true for release.enabled with no stored release", () => {
    expect(hasReleases({ release: { enabled: true } }, null)).toBe(true);
  });

  it("is true for a stored v1.0.0 with no release block", () => {
    expect(hasReleases({}, release("v1.0.0", "2026-10-01T00:00:00Z"))).toBe(
      true,
    );
  });

  it("is false for no release block and no stored release", () => {
    expect(hasReleases({ release: { days: [1] } }, null)).toBe(false);
  });
});

describe("releasesPage", () => {
  it("lists v1.2.0 with its range end, summary and publication, then v1.1.0, and the cursor of the last", async () => {
    const { all } = deps([
      release("v1.2.0", "2026-10-15T11:00:00Z"),
      release("v1.1.0", "2026-10-08T11:00:00Z"),
    ]);
    const page = await releasesPage({ limit: 2 }, all);

    expect({
      releases: page.releases.map(({ version, to, summary, publishedTo }) => ({
        version,
        to,
        summary,
        publishedTo,
      })),
      next: page.next,
    }).toEqual({
      releases: [
        {
          version: "v1.2.0",
          to: "2026-10-15T11:00:00.000Z",
          summary: "Summary of v1.2.0",
          publishedTo: "re-cinq/lore-public",
        },
        {
          version: "v1.1.0",
          to: "2026-10-08T11:00:00.000Z",
          summary: "Summary of v1.1.0",
          publishedTo: "re-cinq/lore-public",
        },
      ],
      next: "2026-10-08T11:00:00.000Z",
    });
  });

  it("answers no cursor when the page holds fewer releases than the limit", async () => {
    const { all } = deps([release("v1.1.0", "2026-10-08T11:00:00Z")]);

    expect((await releasesPage({ limit: 2 }, all)).next).toBe(null);
  });

  it("reads GitHub once, from the end of v1.2.0, and leaves only pull request 3055 unreleased", async () => {
    const { all, asked } = deps([release("v1.2.0", "2026-10-15T11:00:00Z")]);
    const { unreleased } = await releasesPage({ limit: 5 }, all);

    expect({
      asked: asked.filter((entry) => "since" in (entry as object)),
      unreleased: {
        latestVersion: unreleased?.latestVersion,
        numbers: unreleased?.changes.map((change) => change.number),
      },
    }).toEqual({
      asked: [{ since: "2026-10-15T11:00:00.000Z" }],
      unreleased: { latestVersion: "v1.2.0", numbers: [3055] },
    });
  });

  it("reads GitHub from the beginning when no release exists, every change unreleased", async () => {
    const { all, asked } = deps([]);
    const { unreleased } = await releasesPage({ limit: 5 }, all);

    expect({
      asked: asked.filter((entry) => "since" in (entry as object)),
      latestVersion: unreleased?.latestVersion,
      numbers: unreleased?.changes.map((change) => change.number),
    }).toEqual({
      asked: [{ since: "1970-01-01T00:00:00.000Z" }],
      latestVersion: null,
      numbers: [3055, 3000],
    });
  });

  it("lists nothing unreleased when v1.3.0 ended after the last merge", async () => {
    const { all } = deps([release("v1.3.0", "2026-10-22T11:00:00Z")]);

    expect((await releasesPage({ limit: 5 }, all)).unreleased).toMatchObject({
      latestVersion: "v1.3.0",
      changes: [],
    });
  });

  it("reads no GitHub and answers no unreleased block for the page before 2026-10-15", async () => {
    const { all, asked } = deps([
      release("v1.2.0", "2026-10-15T11:00:00Z"),
      release("v1.1.0", "2026-10-08T11:00:00Z"),
    ]);
    const page = await releasesPage(
      { limit: 5, before: "2026-10-15T11:00:00.000Z" },
      all,
    );

    expect({
      versions: page.releases.map((row) => row.version),
      unreleased: page.unreleased,
      asked,
    }).toEqual({
      versions: ["v1.1.0"],
      unreleased: null,
      asked: [
        {
          stored: { before: new Date("2026-10-15T11:00:00.000Z"), limit: 5 },
        },
      ],
    });
  });
});
