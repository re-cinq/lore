import { describe, it, expect } from "vitest";
import { trackerDocument, type TrackedEntry } from "./tracker-text.js";

const REPO = "re-cinq/lore";
const mergedPull: TrackedEntry = {
  kind: "pull",
  number: 2790,
  title: "Utopia: mirror the default branch's commits",
  body: "Pushes each commit.\n\nCloses #2766\nLore-Task: 6f1c2e9a",
  author: "gedaiu",
  labels: ["utopia", "lore"],
  openedAt: "2026-10-16T09:00:00Z",
  closedAt: "2026-10-16T21:08:00Z",
  mergedAt: "2026-10-16T21:08:00Z",
  updatedAt: "2026-10-16T21:09:00Z",
};
const openIssue: TrackedEntry = {
  kind: "issue",
  number: 2766,
  title: "Mirror the traceability graph into Utopia",
  body: "",
  author: "gedaiu",
  labels: [],
  openedAt: "2026-10-15T08:00:00Z",
  closedAt: null,
  mergedAt: null,
  updatedAt: "2026-10-15T08:30:00Z",
};

describe("trackerDocument", () => {
  it("is pull:2790 at its update time with its title, state merged, author, labels, the three times, its page and the description whole", () => {
    expect(trackerDocument(REPO, mergedPull)).toEqual({
      external_id: "pull:2790",
      filename: "pull-2790",
      doc_time: "2026-10-16T21:09:00Z",
      content: [
        "Pull request #2790 in re-cinq/lore: Utopia: mirror the default branch's commits",
        "State: merged",
        "Author: gedaiu",
        "Labels: utopia, lore",
        "Opened: 2026-10-16T09:00:00Z",
        "Closed: 2026-10-16T21:08:00Z",
        "Merged: 2026-10-16T21:08:00Z",
        "Link: https://github.com/re-cinq/lore/pull/2790",
        "",
        "Pushes each commit.\n\nCloses #2766\nLore-Task: 6f1c2e9a",
      ].join("\n"),
    });
  });

  it("is issue:2766 open with no labels, closed or merged time and no description, ending at its page", () => {
    expect(trackerDocument(REPO, openIssue)).toEqual({
      external_id: "issue:2766",
      filename: "issue-2766",
      doc_time: "2026-10-15T08:30:00Z",
      content: [
        "Issue #2766 in re-cinq/lore: Mirror the traceability graph into Utopia",
        "State: open",
        "Author: gedaiu",
        "Opened: 2026-10-15T08:00:00Z",
        "Link: https://github.com/re-cinq/lore/issues/2766",
      ].join("\n"),
    });
  });

  it("says closed for a pull request closed without a merge", () => {
    const state = trackerDocument(REPO, {
      ...mergedPull,
      mergedAt: null,
    }).content?.split("\n")[1];

    expect(state).toBe("State: closed");
  });

  it("keeps a 5,003-character description whole", () => {
    const body = "y".repeat(5003);

    expect(
      trackerDocument(REPO, { ...openIssue, body }).content?.endsWith(body),
    ).toBe(true);
  });
});
