import { describe, it, expect } from "vitest";
import {
  releaseDocument,
  tagDocument,
  type ReleaseEntry,
} from "./release-text.js";

const REPO = "re-cinq/lore";
const SHA = "7b89df02405fcc32f6621ec030f417fea0265694";
const release: ReleaseEntry = {
  tag: "v1.2.0",
  name: "Lore 1.2",
  body: "Mirrors issues.\n\nAnd pull requests.",
  author: "gedaiu",
  publishedAt: "2026-10-17T09:00:00Z",
};

describe("tagDocument", () => {
  it("is tag:v1.2.0 with the commit it points to and its page, and carries no doc_time", () => {
    expect(tagDocument(REPO, { name: "v1.2.0", sha: SHA })).toEqual({
      external_id: "tag:v1.2.0",
      filename: "tag-v1.2.0",
      content: [
        "Tag v1.2.0 in re-cinq/lore",
        `Commit: ${SHA}`,
        "Link: https://github.com/re-cinq/lore/tree/v1.2.0",
      ].join("\n"),
    });
  });
});

describe("releaseDocument", () => {
  it("is release:v1.2.0 at its publish time with its title, tag, author, time, page and the notes whole", () => {
    expect(releaseDocument(REPO, release)).toEqual({
      external_id: "release:v1.2.0",
      filename: "release-v1.2.0",
      doc_time: "2026-10-17T09:00:00Z",
      content: [
        "Release v1.2.0 in re-cinq/lore: Lore 1.2",
        "Tag: v1.2.0",
        "Author: gedaiu",
        "Published: 2026-10-17T09:00:00Z",
        "Link: https://github.com/re-cinq/lore/releases/tag/v1.2.0",
        "",
        "Mirrors issues.\n\nAnd pull requests.",
      ].join("\n"),
    });
  });

  it("titles a release with no name by its tag and ends at its page when it has no notes", () => {
    const { content } = releaseDocument(REPO, {
      ...release,
      name: "",
      body: "",
    });

    expect({
      title: content?.split("\n")[0],
      last: content?.split("\n").at(-1),
    }).toEqual({
      title: "Release v1.2.0 in re-cinq/lore: v1.2.0",
      last: "Link: https://github.com/re-cinq/lore/releases/tag/v1.2.0",
    });
  });
});
