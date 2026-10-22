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
};

describe("commitDocument", () => {
  it("is commit:7b89df02… at the author date, named commit-7b89df02…, with its author, date, parent, link, subject and whole body in that order", () => {
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
