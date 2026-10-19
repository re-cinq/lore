import { describe, it, expect } from "vitest";
import {
  releaseItems,
  tagItems,
  type ReleaseEntry,
} from "./release-statements.js";
import { attribute, relation } from "./statements.js";

const REPO = "re-cinq/lore";
const SHA = "7b89df02405fcc32f6621ec030f417fea0265694";
const TAG = `${REPO}/tree/v1.2.0`;
const COMMIT = `${REPO}/commit/${SHA}`;
const RELEASE = `${REPO}/releases/tag/v1.2.0`;

const release: ReleaseEntry = {
  tag: "v1.2.0",
  name: "Lore 1.2",
  body: "Mirrors issues.\n\nAnd pull requests.",
  author: "gedaiu",
  publishedAt: "2026-10-17T09:00:00Z",
};

describe("tagItems", () => {
  it("returns one tag:v1.2.0 item where the repository contains the tag, which points to its commit, with its name and page", () => {
    expect(tagItems(REPO, { name: "v1.2.0", sha: SHA })).toEqual([
      {
        externalId: "tag:v1.2.0",
        e: [
          [REPO, "Repository", true],
          [TAG, "Tag", true],
          [COMMIT, "Commit", true],
        ],
        s: [
          relation(REPO, "contains", TAG),
          attribute(TAG, "tag", "v1.2.0"),
          attribute(TAG, "permalink", `https://github.com/${TAG}`),
          relation(TAG, "points_to", COMMIT),
        ],
      },
    ]);
  });
});

describe("releaseItems", () => {
  it("returns one release:v1.2.0 item at its publish time that publishes tag v1.2.0, with its title, author, time, page and notes as text", () => {
    expect(releaseItems(REPO, release)).toEqual([
      {
        externalId: "release:v1.2.0",
        doc_time: "2026-10-17T09:00:00Z",
        e: [
          [REPO, "Repository", true],
          [RELEASE, "Release", true],
          [TAG, "Tag", true],
        ],
        s: [
          relation(REPO, "contains", RELEASE),
          attribute(RELEASE, "tag", "v1.2.0"),
          attribute(RELEASE, "title", "Lore 1.2"),
          attribute(RELEASE, "author", "gedaiu"),
          attribute(RELEASE, "published_at", "2026-10-17T09:00:00Z"),
          attribute(RELEASE, "permalink", `https://github.com/${RELEASE}`),
          relation(RELEASE, "publishes", TAG),
          attribute(RELEASE, "text", "Mirrors issues. And pull requests."),
        ],
      },
    ]);
  });

  it("titles a release with no name by its tag and carries no text when it has no notes", () => {
    const [untitled] = releaseItems(REPO, { ...release, name: "", body: "" });

    expect(untitled.s.filter((row) => row[1] === RELEASE)).toEqual([
      attribute(RELEASE, "tag", "v1.2.0"),
      attribute(RELEASE, "title", "v1.2.0"),
      attribute(RELEASE, "author", "gedaiu"),
      attribute(RELEASE, "published_at", "2026-10-17T09:00:00Z"),
      attribute(RELEASE, "permalink", `https://github.com/${RELEASE}`),
      relation(RELEASE, "publishes", TAG),
    ]);
  });
});
