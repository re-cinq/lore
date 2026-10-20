import { describe, it, expect } from "vitest";
import { mapGitHubEvent } from "./github-map.js";

const REPO = { repository: { full_name: "re-cinq/lore" } };

describe("mapGitHubEvent — pull_request", () => {
  it("maps synchronize to github.pull_request.synchronize with repo + pr_number", () => {
    expect(
      mapGitHubEvent(
        "pull_request",
        { ...REPO, action: "synchronize", pull_request: { number: 12 } },
        "d1",
      ),
    ).toEqual([
      {
        eventName: "github.pull_request.synchronize",
        source: "github",
        params: { repo: "re-cinq/lore", pr_number: 12 },
        dedupeKey: "github:d1",
      },
    ]);
  });

  it("maps closed+merged to github.pull_request.closed carrying merged/branch/base_ref/sha/labels, and to github.tracker.changed under the delivery's utopia key", () => {
    const payload = {
      ...REPO,
      action: "closed",
      pull_request: {
        number: 9,
        merged: true,
        head: { ref: "lore/feature-request/auth-abcd1234" },
        base: { ref: "main" },
        merge_commit_sha: "sha9",
        labels: [{ name: "spec" }],
      },
    };

    expect(mapGitHubEvent("pull_request", payload, "d2")).toEqual([
      {
        eventName: "github.pull_request.closed",
        source: "github",
        params: {
          repo: "re-cinq/lore",
          pr_number: 9,
          merged: true,
          branch: "lore/feature-request/auth-abcd1234",
          base_ref: "main",
          merge_commit_sha: "sha9",
          labels: ["spec"],
        },
        dedupeKey: "github:d2",
      },
      {
        eventName: "github.tracker.changed",
        source: "github",
        params: { repo: "re-cinq/lore" },
        dedupeKey: "github:d2:utopia",
      },
    ]);
  });

  it("maps closed-without-merge to the same event with merged:false (so code-review can finish its line)", () => {
    const payload = {
      ...REPO,
      action: "closed",
      pull_request: {
        number: 9,
        merged: false,
        head: { ref: "feature/x" },
        labels: [],
      },
    };

    expect(mapGitHubEvent("pull_request", payload, "d3")).toEqual([
      {
        eventName: "github.pull_request.closed",
        source: "github",
        params: {
          repo: "re-cinq/lore",
          pr_number: 9,
          merged: false,
          branch: "feature/x",
          base_ref: "",
          merge_commit_sha: null,
          labels: [],
        },
        dedupeKey: "github:d3",
      },
      {
        eventName: "github.tracker.changed",
        source: "github",
        params: { repo: "re-cinq/lore" },
        dedupeKey: "github:d3:utopia",
      },
    ]);
  });

  it("maps an edited pull request to github.tracker.changed alone, so the Utopia mirror reads its new title", () => {
    expect(
      mapGitHubEvent(
        "pull_request",
        { ...REPO, action: "edited", pull_request: { number: 9 } },
        "d4",
      ),
    ).toEqual([
      {
        eventName: "github.tracker.changed",
        source: "github",
        params: { repo: "re-cinq/lore" },
        dedupeKey: "github:d4:utopia",
      },
    ]);
  });

  it("maps opened to github.pull_request.opened and github.tracker.changed, each under its own dedupe key", () => {
    expect(
      mapGitHubEvent(
        "pull_request",
        { ...REPO, action: "opened", pull_request: { number: 13 } },
        "d5",
      ).map((event) => [event.eventName, event.dedupeKey]),
    ).toEqual([
      ["github.pull_request.opened", "github:d5"],
      ["github.tracker.changed", "github:d5:utopia"],
    ]);
  });
});

describe("mapGitHubEvent — review and comments", () => {
  it("maps a submitted review carrying the review id/state/author/body", () => {
    expect(
      mapGitHubEvent(
        "pull_request_review",
        {
          ...REPO,
          action: "submitted",
          pull_request: { number: 5 },
          review: {
            id: 900,
            state: "changes_requested",
            user: { login: "alice" },
            author_association: "MEMBER",
            body: "please guard the null case",
          },
        },
        "d5",
      ),
    ).toEqual([
      {
        eventName: "github.pull_request_review.submitted",
        source: "github",
        params: {
          repo: "re-cinq/lore",
          pr_number: 5,
          review_id: 900,
          review_state: "changes_requested",
          review_author: "alice",
          review_author_association: "MEMBER",
          review_body: "please guard the null case",
        },
        dedupeKey: "github:d5",
      },
    ]);
  });

  it("maps a submitted review with no review block to empty review fields", () => {
    expect(
      mapGitHubEvent(
        "pull_request_review",
        { ...REPO, action: "submitted", pull_request: { number: 5 } },
        "d5",
      ),
    ).toEqual([
      {
        eventName: "github.pull_request_review.submitted",
        source: "github",
        params: {
          repo: "re-cinq/lore",
          pr_number: 5,
          review_id: null,
          review_state: "",
          review_author: "",
          review_author_association: "",
          review_body: "",
        },
        dedupeKey: "github:d5",
      },
    ]);
  });

  it("maps a PR issue_comment.created carrying the comment author, its MEMBER standing, id and body", () => {
    const payload = {
      ...REPO,
      action: "created",
      issue: { number: 5, pull_request: {} },
      comment: {
        id: 111,
        body: "please fix",
        user: { login: "alice" },
        author_association: "MEMBER",
      },
    };

    expect(mapGitHubEvent("issue_comment", payload, "d6")).toEqual([
      {
        eventName: "github.issue_comment.created",
        source: "github",
        params: {
          repo: "re-cinq/lore",
          pr_number: 5,
          comment_id: 111,
          comment_author: "alice",
          comment_author_association: "MEMBER",
          comment_body: "please fix",
        },
        dedupeKey: "github:d6",
      },
    ]);
  });

  it("ignores an issue_comment that is not on a PR", () => {
    expect(
      mapGitHubEvent(
        "issue_comment",
        { ...REPO, action: "created", issue: { number: 5 } },
        "d7",
      ),
    ).toEqual([]);
  });

  it("maps a created pull_request_review_comment carrying the comment author, its NONE standing, id and body", () => {
    const payload = {
      ...REPO,
      action: "created",
      pull_request: { number: 8 },
      comment: {
        id: 222,
        body: "why here?",
        user: { login: "bob" },
        author_association: "NONE",
      },
    };

    expect(
      mapGitHubEvent("pull_request_review_comment", payload, "d8"),
    ).toEqual([
      {
        eventName: "github.pull_request_review_comment.created",
        source: "github",
        params: {
          repo: "re-cinq/lore",
          pr_number: 8,
          comment_id: 222,
          comment_author: "bob",
          comment_author_association: "NONE",
          comment_body: "why here?",
          in_reply_to_id: null,
        },
        dedupeKey: "github:d8",
      },
    ]);
  });

  it("surfaces in_reply_to_id when the review comment is a thread reply", () => {
    const payload = {
      ...REPO,
      action: "created",
      pull_request: { number: 8 },
      comment: {
        id: 223,
        body: "ok, fix it",
        user: { login: "bob" },
        in_reply_to_id: 222,
      },
    };

    expect(
      mapGitHubEvent("pull_request_review_comment", payload, "d9"),
    ).toEqual([
      {
        eventName: "github.pull_request_review_comment.created",
        source: "github",
        params: {
          repo: "re-cinq/lore",
          pr_number: 8,
          comment_id: 223,
          comment_author: "bob",
          comment_author_association: "",
          comment_body: "ok, fix it",
          in_reply_to_id: 222,
        },
        dedupeKey: "github:d9",
      },
    ]);
  });

  it("ignores a non-created pull_request_review_comment", () => {
    expect(
      mapGitHubEvent(
        "pull_request_review_comment",
        {
          ...REPO,
          action: "edited",
          pull_request: { number: 8 },
          comment: { id: 222 },
        },
        "d9",
      ),
    ).toEqual([]);
  });
});

describe("mapGitHubEvent — issues.labeled", () => {
  it("carries the label and a trimmed issue snapshot the handler needs", () => {
    const payload = {
      ...REPO,
      action: "labeled",
      label: { name: "lore" },
      issue: {
        number: 42,
        title: "Add X",
        body: "do X",
        html_url: "http://gh/42",
        labels: [{ name: "lore" }, { name: "lore:review" }],
      },
    };

    expect(mapGitHubEvent("issues", payload, "d10")).toEqual([
      {
        eventName: "github.issues.labeled",
        source: "github",
        params: {
          repo: "re-cinq/lore",
          label: "lore",
          issue: {
            number: 42,
            title: "Add X",
            body: "do X",
            html_url: "http://gh/42",
            labels: ["lore", "lore:review"],
          },
        },
        dedupeKey: "github:d10",
      },
      {
        eventName: "github.tracker.changed",
        source: "github",
        params: { repo: "re-cinq/lore" },
        dedupeKey: "github:d10:utopia",
      },
    ]);
  });
});

describe("mapGitHubEvent — issues the Utopia mirror reads", () => {
  it("maps an opened issue to github.tracker.changed alone", () => {
    expect(
      mapGitHubEvent(
        "issues",
        { ...REPO, action: "opened", issue: { number: 43 } },
        "d11",
      ),
    ).toEqual([
      {
        eventName: "github.tracker.changed",
        source: "github",
        params: { repo: "re-cinq/lore" },
        dedupeKey: "github:d11:utopia",
      },
    ]);
  });

  it("returns nothing for an assigned issue, which changes nothing the mirror holds", () => {
    expect(
      mapGitHubEvent(
        "issues",
        { ...REPO, action: "assigned", issue: { number: 43 } },
        "d12",
      ),
    ).toEqual([]);
  });
});

describe("mapGitHubEvent — releases and tags the Utopia mirror reads", () => {
  it("maps a published release to github.release.changed", () => {
    expect(
      mapGitHubEvent(
        "release",
        { ...REPO, action: "published", release: { tag_name: "v1.2.0" } },
        "d13",
      ),
    ).toEqual([
      {
        eventName: "github.release.changed",
        source: "github",
        params: { repo: "re-cinq/lore" },
        dedupeKey: "github:d13:utopia",
      },
    ]);
  });

  it("maps a created tag to github.release.changed", () => {
    expect(
      mapGitHubEvent(
        "create",
        { ...REPO, ref_type: "tag", ref: "v1.2.0" },
        "d14",
      ),
    ).toEqual([
      {
        eventName: "github.release.changed",
        source: "github",
        params: { repo: "re-cinq/lore" },
        dedupeKey: "github:d14:utopia",
      },
    ]);
  });

  it("returns nothing for a created branch or a release still a draft", () => {
    expect([
      mapGitHubEvent(
        "create",
        { ...REPO, ref_type: "branch", ref: "feat/x" },
        "d15",
      ),
      mapGitHubEvent("release", { ...REPO, action: "created" }, "d16"),
    ]).toEqual([[], []]);
  });
});

describe("mapGitHubEvent — repository", () => {
  it("maps a renamed re-cinq/HAL-engine to github.repository.renamed from re-cinq/HAL-engine to re-cinq/HALEngine", () => {
    const payload = {
      action: "renamed",
      changes: { repository: { name: { from: "HAL-engine" } } },
      repository: {
        full_name: "re-cinq/HALEngine",
        owner: { login: "re-cinq" },
      },
    };

    expect(mapGitHubEvent("repository", payload, "d13")).toEqual([
      {
        eventName: "github.repository.renamed",
        source: "github",
        params: { from: "re-cinq/HAL-engine", to: "re-cinq/HALEngine" },
        dedupeKey: "github:d13",
      },
    ]);
  });

  it("returns nothing for an archived repository", () => {
    expect(
      mapGitHubEvent("repository", { ...REPO, action: "archived" }, "d14"),
    ).toEqual([]);
  });
});

describe("mapGitHubEvent — check_suite and push", () => {
  it("maps a completed check_suite on abc123 to github.check_suite.completed carrying PRs 4 and 9", () => {
    const payload = {
      ...REPO,
      action: "completed",
      check_suite: {
        head_sha: "abc123",
        pull_requests: [{ number: 4 }, { number: 9 }],
      },
    };

    expect(mapGitHubEvent("check_suite", payload, "d20")).toEqual([
      {
        eventName: "github.check_suite.completed",
        source: "github",
        params: {
          repo: "re-cinq/lore",
          head_sha: "abc123",
          pr_numbers: [4, 9],
        },
        dedupeKey: "github:d20",
      },
    ]);
  });

  it("returns nothing for a requested check_suite", () => {
    expect(
      mapGitHubEvent(
        "check_suite",
        { ...REPO, action: "requested", check_suite: { head_sha: "abc123" } },
        "d21",
      ),
    ).toEqual([]);
  });

  it("maps a push to refs/heads/main to github.push on branch main", () => {
    expect(
      mapGitHubEvent("push", { ...REPO, ref: "refs/heads/main" }, "d22"),
    ).toEqual([
      {
        eventName: "github.push",
        source: "github",
        params: { repo: "re-cinq/lore", branch: "main" },
        dedupeKey: "github:d22",
      },
    ]);
  });

  it("returns nothing for a push of the tag refs/tags/release", () => {
    expect(
      mapGitHubEvent("push", { ...REPO, ref: "refs/tags/release" }, "d23"),
    ).toEqual([]);
  });
});

describe("mapGitHubEvent — guards", () => {
  it("returns nothing when the repository is missing", () => {
    expect(
      mapGitHubEvent(
        "pull_request",
        { action: "opened", pull_request: { number: 1 } },
        "d11",
      ),
    ).toEqual([]);
  });

  it("returns nothing for an unhandled event type", () => {
    expect(
      mapGitHubEvent("star", { ...REPO, action: "created" }, "d12"),
    ).toEqual([]);
  });
});
