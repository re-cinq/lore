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

  it("maps closed+merged to github.pull_request.closed carrying merged/branch/sha/labels", () => {
    const payload = {
      ...REPO,
      action: "closed",
      pull_request: {
        number: 9,
        merged: true,
        head: { ref: "lore/feature-request/auth-abcd1234" },
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
          merge_commit_sha: "sha9",
          labels: ["spec"],
        },
        dedupeKey: "github:d2",
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
          merge_commit_sha: null,
          labels: [],
        },
        dedupeKey: "github:d3",
      },
    ]);
  });

  it("ignores edited", () => {
    expect(
      mapGitHubEvent(
        "pull_request",
        { ...REPO, action: "edited", pull_request: { number: 9 } },
        "d4",
      ),
    ).toEqual([]);
  });
});

describe("mapGitHubEvent — review and comments", () => {
  it("maps a submitted review to github.pull_request_review.submitted", () => {
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
        params: { repo: "re-cinq/lore", pr_number: 5 },
        dedupeKey: "github:d5",
      },
    ]);
  });

  it("maps a PR issue_comment.created carrying the comment author/id/body", () => {
    const payload = {
      ...REPO,
      action: "created",
      issue: { number: 5, pull_request: {} },
      comment: { id: 111, body: "please fix", user: { login: "alice" } },
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

  it("maps a created pull_request_review_comment carrying the comment author/id/body", () => {
    const payload = {
      ...REPO,
      action: "created",
      pull_request: { number: 8 },
      comment: { id: 222, body: "why here?", user: { login: "bob" } },
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
          comment_body: "why here?",
        },
        dedupeKey: "github:d8",
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

describe("mapGitHubEvent — check fan-out", () => {
  it("fans out check_suite.completed to one event per backing PR with per-PR dedupe keys", () => {
    const payload = {
      ...REPO,
      action: "completed",
      check_suite: { pull_requests: [{ number: 1 }, { number: 2 }] },
    };
    expect(mapGitHubEvent("check_suite", payload, "d8")).toEqual([
      {
        eventName: "github.check_suite.completed",
        source: "github",
        params: { repo: "re-cinq/lore", pr_number: 1 },
        dedupeKey: "github:d8:1",
      },
      {
        eventName: "github.check_suite.completed",
        source: "github",
        params: { repo: "re-cinq/lore", pr_number: 2 },
        dedupeKey: "github:d8:2",
      },
    ]);
  });

  it("returns nothing for a check with no backing PRs", () => {
    expect(
      mapGitHubEvent(
        "check_run",
        { ...REPO, action: "completed", check_run: { pull_requests: [] } },
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
    ]);
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
