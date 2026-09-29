import { describe, it, expect } from "vitest";
import { findPlanIssues, storyMarker, taskMarker } from "./plan-issues.js";
import type { IssueRef } from "../../outbound/project/lib/github-port.js";

const PLAN = "3b3a67af-17b6-498b-b780-6738a0092603";

function issue(
  number: number,
  body: string,
  state: "open" | "closed" = "open",
): IssueRef {
  return {
    repo: "re-cinq/lore",
    number,
    title: `#${number}`,
    state,
    labels: [],
    body,
  };
}

describe("findPlanIssues", () => {
  it("finds story #2260 and task issues T001 #2261 and T002 #2262 of plan 3b3a67af by the markers Lore filed them with", () => {
    const found = findPlanIssues(
      [
        issue(2260, `story\n\n${storyMarker(PLAN)}`),
        issue(2261, `task\n\n${taskMarker(PLAN, "T001")}`),
        issue(2262, `task\n\n${taskMarker(PLAN, "T002")}`, "closed"),
        issue(2270, `another plan\n\n${taskMarker("other-plan", "T001")}`),
        issue(2271, "a person's issue"),
      ],
      PLAN,
    );

    expect({
      story: found.story?.number,
      tasks: Object.fromEntries(
        [...found.tasks].map(([id, found]) => [id, found.number]),
      ),
    }).toEqual({ story: 2260, tasks: { T001: 2261, T002: 2262 } });
  });

  it("finds nothing for plan 3b3a67af among issues filed without markers", () => {
    const found = findPlanIssues([issue(2240, "User story: slice")], PLAN);

    expect({ story: found.story, tasks: found.tasks.size }).toEqual({
      story: undefined,
      tasks: 0,
    });
  });
});
