import { describe, it, expect } from "vitest";
import { groupImplemented, groupRoadmap } from "./group.js";
import { closedIssue, mergedPr, openIssue } from "./fixtures.js";

describe("groupImplemented", () => {
  it("buckets PRs by author", () => {
    const groups = groupImplemented(
      {
        prs: [
          mergedPr({ number: 1, author: "bob" }),
          mergedPr({ number: 2, author: "alice" }),
          mergedPr({ number: 3, author: "bob" }),
        ],
        issues: [],
      },
      "person",
    );

    expect(groups.map((g) => [g.key, g.changes.map((c) => c.number)])).toEqual([
      ["alice", [2]],
      ["bob", [1, 3]],
    ]);
  });

  it("buckets by area label without the prefix", () => {
    const groups = groupImplemented(
      {
        prs: [mergedPr({ number: 1, labels: ["area:floor"] })],
        issues: [closedIssue({ number: 12, labels: ["area:web-ui", "bug"] })],
      },
      "area",
    );

    expect(groups.map((g) => g.key)).toEqual(["floor", "web-ui"]);
  });

  it("puts unlabeled items in an unlabeled bucket", () => {
    const groups = groupImplemented(
      { prs: [mergedPr({ number: 1, labels: ["bug"] })], issues: [] },
      "area",
    );

    expect(groups).toMatchObject([{ key: "unlabeled" }]);
  });

  it("lists a closed issue under its assignees", () => {
    const groups = groupImplemented(
      { prs: [], issues: [closedIssue({ number: 12, assignees: ["carol"] })] },
      "person",
    );

    expect(groups).toMatchObject([{ key: "carol" }]);
  });
});

describe("groupRoadmap", () => {
  it("lists an issue under each of its assignees", () => {
    const groups = groupRoadmap(
      [openIssue({ number: 20, assignees: ["alice", "bob"] })],
      "person",
    );

    expect(groups.map((g) => [g.key, g.changes.map((c) => c.number)])).toEqual([
      ["alice", [20]],
      ["bob", [20]],
    ]);
  });

  it("skips an open issue nobody is assigned to", () => {
    expect(groupRoadmap([openIssue({ assignees: [] })], "person")).toEqual([]);
  });
});
