import { describe, it, expect } from "vitest";
import {
  releaseStatementItems,
  tagStatementItems,
} from "./release-statements.js";

const SHA = "7b89df02405fcc32f6621ec030f417fea0265694";

describe("tagStatementItems", () => {
  it("is tag:v1.2.0 naming the tag by v1.2.0 and its link and pointing it to the commit 7b89df02…", () => {
    expect(
      tagStatementItems("re-cinq/lore", { name: "v1.2.0", sha: SHA }),
    ).toEqual([
      {
        externalId: "tag:v1.2.0",
        e: [
          ["re-cinq/lore/tree/v1.2.0", "Tag", true],
          [`re-cinq/lore/commit/${SHA}`, "Commit", true],
        ],
        s: [
          [
            null,
            "re-cinq/lore/tree/v1.2.0",
            "known_as",
            null,
            "v1.2.0",
            {},
            null,
            null,
          ],
          [
            null,
            "re-cinq/lore/tree/v1.2.0",
            "permalink",
            null,
            "https://github.com/re-cinq/lore/tree/v1.2.0",
            {},
            null,
            null,
          ],
          [
            null,
            "re-cinq/lore/tree/v1.2.0",
            "points_to",
            `re-cinq/lore/commit/${SHA}`,
            null,
            {},
            null,
            null,
          ],
        ],
      },
    ]);
  });
});

describe("releaseStatementItems", () => {
  const release = {
    tag: "v1.2.0",
    name: "Spring release",
    body: "Notes",
    author: "gedaiu",
    publishedAt: "2026-10-20T10:00:00Z",
  };

  it("is release:v1.2.0 at its publish time with its title and link, publishing the tag v1.2.0", () => {
    expect(releaseStatementItems("re-cinq/lore", release)).toEqual([
      {
        externalId: "release:v1.2.0",
        doc_time: "2026-10-20T10:00:00Z",
        e: [
          ["re-cinq/lore/releases/tag/v1.2.0", "Release", true],
          ["re-cinq/lore/tree/v1.2.0", "Tag", true],
        ],
        s: [
          [
            null,
            "re-cinq/lore/releases/tag/v1.2.0",
            "title",
            null,
            "Spring release",
            {},
            null,
            null,
          ],
          [
            null,
            "re-cinq/lore/releases/tag/v1.2.0",
            "permalink",
            null,
            "https://github.com/re-cinq/lore/releases/tag/v1.2.0",
            {},
            null,
            null,
          ],
          [
            null,
            "re-cinq/lore/releases/tag/v1.2.0",
            "publishes",
            "re-cinq/lore/tree/v1.2.0",
            null,
            {},
            null,
            null,
          ],
        ],
      },
    ]);
  });

  it("titles a release given no name by its tag v1.2.0", () => {
    const [pushed] = releaseStatementItems("re-cinq/lore", {
      ...release,
      name: "",
    });

    expect(pushed.s[0][4]).toEqual("v1.2.0");
  });
});
