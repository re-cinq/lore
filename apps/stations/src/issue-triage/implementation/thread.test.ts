import { describe, expect, it } from "vitest";
import { issueThread } from "./thread.js";

describe("issueThread", () => {
  it("lists the comments oldest first with author and date, then linked pull request #12 as merged", () => {
    const thread = issueThread(
      [
        {
          id: 2,
          user: "reporter",
          created_at: "2026-10-30T10:00:00Z",
          body: "Still broken on 1.4",
        },
        {
          id: 1,
          user: "lore",
          created_at: "2026-10-29T10:00:00Z",
          body: "Could not reproduce",
        },
      ],
      [
        {
          number: 12,
          title: "Fix widget",
          state: "closed",
          merged: true,
          url: "https://github.com/acme/widgets/pull/12",
        },
      ],
    );

    expect(thread).toEqual(
      "# Issue thread\n\n" +
        "## Comments\n\n" +
        "### lore, 2026-10-29T10:00:00Z\n\nCould not reproduce\n\n" +
        "### reporter, 2026-10-30T10:00:00Z\n\nStill broken on 1.4\n\n" +
        "## Linked pull requests\n\n" +
        "- #12 Fix widget (merged) https://github.com/acme/widgets/pull/12\n",
    );
  });

  it("says there are no comments and no linked pull requests when the issue has neither", () => {
    expect(issueThread([], [])).toEqual(
      "# Issue thread\n\n## Comments\n\nNone.\n\n## Linked pull requests\n\nNone.\n",
    );
  });

  it("cuts a 10,000-character comment to 4,000 characters and marks the cut", () => {
    const thread = issueThread(
      [
        {
          id: 1,
          user: "reporter",
          created_at: "2026-10-30",
          body: "x".repeat(10_000),
        },
      ],
      [],
    );

    expect(thread).toContain(`${"x".repeat(4_000)}\n[comment cut]`);
    expect(thread).not.toContain("x".repeat(4_001));
  });
});
