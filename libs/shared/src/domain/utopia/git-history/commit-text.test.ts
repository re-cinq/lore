import { describe, it, expect } from "vitest";
import { commitDocument, type MirroredCommit } from "./commit-text.js";

const SHA = "7b89df02405fcc32f6621ec030f417fea0265694";
const PARENT = "c36ee3e92ea3ad481b85612e36172c13af3bdea7";
const commit: MirroredCommit = {
  sha: SHA,
  parents: [PARENT],
  subject: "Utopia: give its database a full CPU, two to burst (#2773)",
  body: "Gives the pod a full CPU.\n\nCloses #12\nLore-Task: 6f1c2e9a",
  author: "Szabo Bogdan",
  authoredAt: "2026-10-16T08:12:00Z",
  files: ["infra/terraform/utopia.tf", "charts/utopia/values.yaml"],
};

describe("commitDocument", () => {
  it("is commit:7b89df02… at the author date, named commit-7b89df02…, with its author, date, parent, link, pull request #2773, closed issue #12, changed files, subject and whole body in that order", () => {
    expect(commitDocument("re-cinq/lore", commit)).toEqual({
      external_id: `commit:${SHA}`,
      filename: `commit-${SHA}`,
      doc_time: "2026-10-16T08:12:00Z",
      content: [
        `Commit ${SHA} in re-cinq/lore`,
        "Author: Szabo Bogdan",
        "Date: 2026-10-16T08:12:00Z",
        `Parents: ${PARENT}`,
        `Link: https://github.com/re-cinq/lore/commit/${SHA}`,
        "Pull request: https://github.com/re-cinq/lore/pull/2773",
        "Issues: closes https://github.com/re-cinq/lore/issues/12",
        "Files changed: infra/terraform/utopia.tf, charts/utopia/values.yaml",
        "",
        "Utopia: give its database a full CPU, two to burst (#2773)",
        "",
        "Gives the pod a full CPU.\n\nCloses #12\nLore-Task: 6f1c2e9a",
      ].join("\n"),
    });
  });

  it("lists both parents of a merge commit and none for a root commit", () => {
    const lines = (parents: string[]) =>
      commitDocument("re-cinq/lore", { ...commit, parents }).content?.split(
        "\n",
      )[3];

    expect([lines([PARENT, "aaa"]), lines([])]).toEqual([
      `Parents: ${PARENT}, aaa`,
      "Parents: none",
    ]);
  });

  it("ends at the subject for a commit with no body", () => {
    expect(
      commitDocument("re-cinq/lore", { ...commit, body: "" }).content?.endsWith(
        "(#2773)",
      ),
    ).toBe(true);
  });

  it("keeps a 5,003-character body whole", () => {
    const body = "x".repeat(5003);

    expect(
      commitDocument("re-cinq/lore", { ...commit, body }).content?.endsWith(
        body,
      ),
    ).toBe(true);
  });
});

describe("commitDocument links", () => {
  const head = (changes: Partial<MirroredCommit>) =>
    commitDocument("re-cinq/lore", { ...commit, ...changes })
      .content?.split("\n\n")[0]
      .split("\n")
      .slice(5);

  it("names no pull request, issue or file for a commit whose message names none and that changed nothing", () => {
    expect(head({ subject: "Tidy", body: "", files: [] })).toEqual([]);
  });

  it("links #4012 as closed and #3998 and #4001 as referred to from Fixes, Refs and Related lines", () => {
    expect(
      head({
        subject: "Tidy",
        body: "Fixes #4012\nRefs #3998\nRelated: #4001",
        files: [],
      }),
    ).toEqual([
      "Issues: closes https://github.com/re-cinq/lore/issues/4012, refers to https://github.com/re-cinq/lore/issues/3998, refers to https://github.com/re-cinq/lore/issues/4001",
    ]);
  });

  it("names the first 50 of 60 changed files and how many more", () => {
    const files = Array.from({ length: 60 }, (_, index) => `f${index}.ts`);

    expect(head({ subject: "Tidy", body: "", files })).toEqual([
      `Files changed: ${files.slice(0, 50).join(", ")} and 10 more`,
    ]);
  });
});
