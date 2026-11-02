import { describe, it, expect } from "vitest";
import { commitStatementItems } from "./commit-statements.js";
import type { MirroredCommit } from "./commit-text.js";

const SHA = "7b89df02405fcc32f6621ec030f417fea0265694";
const PARENT = "c36ee3e92ea3ad481b85612e36172c13af3bdea7";
const commit: MirroredCommit = {
  sha: SHA,
  parents: [PARENT],
  subject: "Utopia: give its database a full CPU (#2773)",
  body: "Closes #12",
  author: "Szabo Bogdan",
  authoredAt: "2026-10-16T08:12:00Z",
  files: ["infra/utopia.tf"],
};
const SUBJECT = `re-cinq/lore/commit/${SHA}`;

describe("commitStatementItems", () => {
  it("is one item commit:7b89df02… at the author date naming the commit by its short sha, title and link, the parent it follows, the pull request #2773 it merges, the file it changes and its author", () => {
    expect(commitStatementItems("re-cinq/lore", commit)).toEqual([
      {
        externalId: `commit:${SHA}`,
        doc_time: "2026-10-16T08:12:00Z",
        e: [
          [SUBJECT, "Commit", true],
          ["github.com/Szabo Bogdan", "Person", true],
          [`re-cinq/lore/commit/${PARENT}`, "Commit", true],
          ["re-cinq/lore/pull/2773", "PullRequest", true],
          ["re-cinq/lore:infra/utopia.tf", "SourceFile", true],
        ],
        s: [
          [null, SUBJECT, "known_as", null, "7b89df0", {}, null, null],
          [null, SUBJECT, "title", null, commit.subject, {}, null, null],
          [
            null,
            SUBJECT,
            "permalink",
            null,
            `https://github.com/${SUBJECT}`,
            {},
            null,
            null,
          ],
          [
            null,
            SUBJECT,
            "authored_by",
            "github.com/Szabo Bogdan",
            null,
            {},
            null,
            null,
          ],
          [
            null,
            SUBJECT,
            "follows",
            `re-cinq/lore/commit/${PARENT}`,
            null,
            {},
            null,
            null,
          ],
          [
            null,
            SUBJECT,
            "merges",
            "re-cinq/lore/pull/2773",
            null,
            {},
            null,
            null,
          ],
          [
            null,
            SUBJECT,
            "changes",
            "re-cinq/lore:infra/utopia.tf",
            null,
            {},
            null,
            null,
          ],
          [
            null,
            "re-cinq/lore:infra/utopia.tf",
            "path",
            null,
            "infra/utopia.tf",
            {},
            null,
            null,
          ],
          [
            null,
            "re-cinq/lore:infra/utopia.tf",
            "known_as",
            null,
            "utopia.tf",
            {},
            null,
            null,
          ],
          [
            null,
            "re-cinq/lore:infra/utopia.tf",
            "known_as",
            null,
            "infra/utopia.tf",
            {},
            null,
            null,
          ],
        ],
      },
    ]);
  });

  it("names no pull request for a subject without a trailing number, no parent for a root commit and no author for an empty one", () => {
    const [pushed] = commitStatementItems("re-cinq/lore", {
      ...commit,
      parents: [],
      subject: "Fix the build",
      author: "",
      files: [],
    });

    expect(pushed.s.map(([, , phrase]) => phrase)).toEqual([
      "known_as",
      "title",
      "permalink",
    ]);
  });

  it("names the first 50 of 60 changed files", () => {
    const files = Array.from({ length: 60 }, (_, index) => `src/f${index}.ts`);
    const statementItems = commitStatementItems("re-cinq/lore", {
      ...commit,
      files,
    });

    expect(
      statementItems
        .flatMap((pushed) => pushed.s)
        .filter(([, , phrase]) => phrase === "changes").length,
    ).toEqual(50);
  });

  it("splits a commit whose statements pass the push limit into items commit:<sha>, commit:<sha>.2, each naming the commit", () => {
    const parents = Array.from({ length: 250 }, (_, index) => `parent${index}`);
    const statementItems = commitStatementItems("re-cinq/lore", {
      ...commit,
      parents,
    });

    expect(
      statementItems.map((pushed) => [pushed.externalId, pushed.e[0][0]]),
    ).toEqual([
      [`commit:${SHA}`, SUBJECT],
      [`commit:${SHA}.2`, SUBJECT],
    ]);
  });
});
