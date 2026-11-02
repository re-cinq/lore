import { describe, it, expect } from "vitest";
import { trackedStatementItems } from "./tracker-statements.js";
import type { TrackedEntry } from "./tracker-text.js";

const mergedPull: TrackedEntry = {
  kind: "pull",
  number: 2790,
  title: "Utopia: mirror the default branch's commits",
  body: "Pushes each commit.\n\nCloses #2766\nRefs #2700",
  author: "gedaiu",
  labels: ["utopia"],
  openedAt: "2026-10-16T09:00:00Z",
  closedAt: "2026-10-16T21:08:00Z",
  mergedAt: "2026-10-16T21:08:00Z",
  updatedAt: "2026-10-16T21:09:00Z",
};
const openIssue: TrackedEntry = {
  ...mergedPull,
  kind: "issue",
  number: 2766,
  title: "Mirror the traceability graph into Utopia",
  body: "Fixes #1",
  closedAt: null,
  mergedAt: null,
  updatedAt: "2026-10-15T08:30:00Z",
};

describe("trackedStatementItems", () => {
  it("is pull:2790 at its update time naming the pull request by #2790 and re-cinq/lore#2790, its title and link, its author, the issue #2766 it closes and the issue #2700 it refers to", () => {
    expect(trackedStatementItems("re-cinq/lore", mergedPull)).toEqual([
      {
        externalId: "pull:2790",
        doc_time: "2026-10-16T21:09:00Z",
        e: [
          ["re-cinq/lore/pull/2790", "PullRequest", true],
          ["github.com/gedaiu", "Person", true],
          ["re-cinq/lore/issues/2766", "Issue", true],
          ["re-cinq/lore/issues/2700", "Issue", true],
        ],
        s: [
          [
            null,
            "re-cinq/lore/pull/2790",
            "known_as",
            null,
            "#2790",
            {},
            null,
            null,
          ],
          [
            null,
            "re-cinq/lore/pull/2790",
            "known_as",
            null,
            "re-cinq/lore#2790",
            {},
            null,
            null,
          ],
          [
            null,
            "re-cinq/lore/pull/2790",
            "title",
            null,
            mergedPull.title,
            {},
            null,
            null,
          ],
          [
            null,
            "re-cinq/lore/pull/2790",
            "permalink",
            null,
            "https://github.com/re-cinq/lore/pull/2790",
            {},
            null,
            null,
          ],
          [
            null,
            "re-cinq/lore/pull/2790",
            "authored_by",
            "github.com/gedaiu",
            null,
            {},
            null,
            null,
          ],
          [
            null,
            "re-cinq/lore/pull/2790",
            "closes",
            "re-cinq/lore/issues/2766",
            null,
            {},
            null,
            null,
          ],
          [
            null,
            "re-cinq/lore/pull/2790",
            "refers_to",
            "re-cinq/lore/issues/2700",
            null,
            {},
            null,
            null,
          ],
        ],
      },
    ]);
  });

  it("is issue:2766 as an Issue that closes nothing, though its description says Fixes #1", () => {
    const [pushed] = trackedStatementItems("re-cinq/lore", openIssue);

    expect({
      id: pushed.externalId,
      subject: pushed.e[0],
      phrases: pushed.s.map(([, , phrase]) => phrase),
    }).toEqual({
      id: "issue:2766",
      subject: ["re-cinq/lore/issues/2766", "Issue", true],
      phrases: ["known_as", "known_as", "title", "permalink", "authored_by"],
    });
  });

  it("names no author for an entry whose author is empty", () => {
    const [pushed] = trackedStatementItems("re-cinq/lore", {
      ...openIssue,
      author: "",
    });

    expect(pushed.s.map(([, , phrase]) => phrase)).toEqual([
      "known_as",
      "known_as",
      "title",
      "permalink",
    ]);
  });
});
