import { describe, expect, it } from "vitest";
import { linkedPullRequests } from "./platform-github-issue-links.js";

const pull12 = {
  number: 12,
  title: "Fix widget",
  state: "closed",
  html_url: "https://github.com/acme/widgets/pull/12",
  pull_request: { merged_at: "2026-10-30T10:00:00Z" },
};

describe("linkedPullRequests", () => {
  it("keeps pull request #12 once as merged and drops issue #13 and the labeled event", () => {
    expect(
      linkedPullRequests([
        { event: "cross-referenced", source: { issue: pull12 } },
        { event: "cross-referenced", source: { issue: pull12 } },
        {
          event: "cross-referenced",
          source: {
            issue: {
              number: 13,
              title: "Related bug",
              html_url: "https://github.com/acme/widgets/issues/13",
            },
          },
        },
        { event: "labeled" },
      ]),
    ).toEqual([
      {
        number: 12,
        title: "Fix widget",
        state: "closed",
        merged: true,
        url: "https://github.com/acme/widgets/pull/12",
      },
    ]);
  });
});
