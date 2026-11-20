import { describe, expect, it } from "vitest";
import { releaseRow } from "./release-row.js";

const CHANGE = {
  kind: "pr",
  number: 7,
  title: "Add the release line",
  url: "https://github.com/re-cinq/lore-security/pull/7",
  people: ["gedaiu"],
  at: "2026-11-19T10:00:00.000Z",
};
const NEEDS = {
  release_repo: "re-cinq/lore-security",
  release_version: "v1.3.0",
  release_sha: "bbb222",
  release_bump_kind: "minor",
  range_to: "2026-11-20T09:00:00.000Z",
};
const CHANGES_FILE = JSON.stringify({ changes: [CHANGE] });

describe("the release store row", () => {
  it("builds the row of v1.3.0 from every need, the changes file and the trimmed notes", () => {
    expect(
      releaseRow(
        {
          ...NEEDS,
          previous_tag: "v1.2.4",
          range_from: "2026-11-13T09:00:00.000Z",
          published_to: "re-cinq/lore",
          release_url: "https://github.com/re-cinq/lore/releases/tag/v1.3.0",
        },
        { changesFile: CHANGES_FILE, notes: "Adds the release line.\n" },
      ),
    ).toEqual({
      repo: "re-cinq/lore-security",
      version: "v1.3.0",
      previousTag: "v1.2.4",
      sha: "bbb222",
      bump: "minor",
      rangeFrom: new Date("2026-11-13T09:00:00.000Z"),
      rangeTo: new Date("2026-11-20T09:00:00.000Z"),
      summary: "Adds the release line.",
      changes: [CHANGE],
      releaseUrl: "https://github.com/re-cinq/lore/releases/tag/v1.3.0",
      publishedTo: "re-cinq/lore",
    });
  });

  it("leaves previousTag, rangeFrom, releaseUrl and publishedTo null for a first release published nowhere", () => {
    expect(
      releaseRow(NEEDS, { changesFile: CHANGES_FILE, notes: "First." }),
    ).toMatchObject({
      previousTag: null,
      rangeFrom: null,
      releaseUrl: null,
      publishedTo: null,
    });
  });

  it("refuses a bump kind of huge", () => {
    expect(() =>
      releaseRow(
        { ...NEEDS, release_bump_kind: "huge" },
        { changesFile: CHANGES_FILE, notes: "x" },
      ),
    ).toThrow(/huge/);
  });
});
