import { describe, it, expect } from "vitest";
import { groupPeople } from "./group.js";
import { closedIssue, mergedPr, openIssue, openPr } from "./fixtures.js";

const none = { prs: [], issues: [] };
const numbers = (people: ReturnType<typeof groupPeople>) =>
  people.map((p) => ({
    login: p.login,
    did: p.did.map((c) => c.number),
    next: p.next.map((c) => c.number),
  }));

describe("groupPeople", () => {
  it("puts a merged PR under its author and sorts people by login", () => {
    const people = groupPeople([
      {
        did: {
          prs: [
            mergedPr({ number: 1, author: "bob" }),
            mergedPr({ number: 2, author: "alice" }),
            mergedPr({ number: 3, author: "bob" }),
          ],
          issues: [],
        },
        next: none,
      },
    ]);

    expect(numbers(people)).toEqual([
      { login: "alice", did: [2], next: [] },
      { login: "bob", did: [1, 3], next: [] },
    ]);
  });

  it("lists a closed issue under each assignee and an unassigned one under unassigned", () => {
    const people = groupPeople([
      {
        did: {
          prs: [],
          issues: [
            closedIssue({ number: 12, assignees: ["carol", "dan"] }),
            closedIssue({ number: 13, assignees: [] }),
          ],
        },
        next: none,
      },
    ]);

    expect(numbers(people)).toEqual([
      { login: "carol", did: [12], next: [] },
      { login: "dan", did: [12], next: [] },
      { login: "unassigned", did: [13], next: [] },
    ]);
  });

  it("leads a person's next with their open PRs, then their assigned issues", () => {
    const people = groupPeople([
      {
        did: none,
        next: {
          prs: [openPr({ number: 30, author: "alice" })],
          issues: [openIssue({ number: 20, assignees: ["alice"] })],
        },
      },
    ]);

    expect(numbers(people)).toEqual([
      { login: "alice", did: [], next: [30, 20] },
    ]);
  });

  it("skips an open issue nobody is assigned to", () => {
    expect(
      groupPeople([
        {
          did: none,
          next: { prs: [], issues: [openIssue({ assignees: [] })] },
        },
      ]),
    ).toEqual([]);
  });

  it("joins one person's work across two repos into one entry", () => {
    const people = groupPeople([
      { did: { prs: [mergedPr({ number: 1 })], issues: [] }, next: none },
      {
        did: none,
        next: {
          prs: [],
          issues: [openIssue({ repo: "re-cinq/otto", assignees: ["alice"] })],
        },
      },
    ]);

    expect(numbers(people)).toEqual([{ login: "alice", did: [1], next: [20] }]);
  });
});
