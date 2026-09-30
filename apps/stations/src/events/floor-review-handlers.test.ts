import { describe, expect, it } from "vitest";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  recordedFloor,
  type FloorRequest,
} from "@re-cinq/lore-shared/floor/recorded-floor.js";
import {
  FLOOR_REVIEW_EVENTS,
  floorReviewHandlers,
} from "./floor-review-handlers.js";

const OPEN_PULL: PullRef = {
  repo: "re-cinq/lore",
  number: 412,
  title: "Fix the login",
  branch: "fix/login",
  state: "open",
  labels: [],
  url: "https://github.com/re-cinq/lore/pull/412",
  author: "gedaiu",
  draft: false,
  headSha: "sha-new",
};

const OPEN_REVIEW_RUN = {
  id: "open-1",
  lineId: "code-review",
  lineHash: "hash",
  repo: "github.com/re-cinq/lore",
  subjectKey: null,
  startItems: {
    pr_url: { kind: "value", ref: OPEN_PULL.url, by: "lore" },
    head_sha: { kind: "value", ref: "sha-old", by: "lore" },
  },
  outcome: null,
  reason: null,
  finishedAt: null,
};

function scene(given: { autoReview?: boolean; runs?: unknown[] } = {}) {
  const recorded = recordedFloor((request) =>
    answerOf(request, given.runs ?? []),
  );
  const handlers = floorReviewHandlers({
    autoReview: () => Promise.resolve(given.autoReview ?? true),
    review: () =>
      Promise.resolve({
        floor: recorded.floor,
        pulls: {
          get: () => Promise.resolve(OPEN_PULL),
          comment: () => Promise.resolve(),
          listCommits: () => Promise.resolve([]),
        },
        issues: { get: () => Promise.resolve(null) },
      }),
  });
  const deliver = (eventName: string, params: Record<string, unknown>) =>
    handlers.get(eventName)!({
      repo: "re-cinq/lore",
      pr_number: 412,
      ...params,
    });

  return { deliver, handlers, requests: recorded.requests };
}

function answerOf(request: FloorRequest, runs: unknown[]): unknown {
  if (request.path.startsWith("/assembly-runs?")) {
    return { items: runs, nextCursor: null };
  }

  return { run: { id: "run-new" }, joined: true };
}

function writes(requests: FloorRequest[]): string[] {
  return requests
    .filter((request) => request.method === "POST")
    .map((request) => request.path);
}

describe("floorReviewHandlers", () => {
  it("answers every review event name it asks the bus for", () => {
    const { handlers } = scene();

    expect([...handlers.keys()].sort()).toEqual(
      [...FLOOR_REVIEW_EVENTS].sort(),
    );
  });

  it("starts code-review when a pull request opens in a repository with auto_review on", async () => {
    const { deliver, requests } = scene();

    await deliver("github.pull_request.opened", {});

    expect(writes(requests)).toEqual(["/assembly-lines/code-review/start"]);
  });

  it("asks the floor nothing when auto_review is off", async () => {
    const { deliver, requests } = scene({ autoReview: false });

    await deliver("github.pull_request.synchronize", {});

    expect(requests).toEqual([]);
  });

  it("starts a forced code-review when gedaiu comments @lore review", async () => {
    const { deliver, requests } = scene();

    await deliver("github.issue_comment.created", {
      comment_author: "gedaiu",
      comment_body: "@lore review",
    });

    expect(writes(requests)).toEqual(["/assembly-lines/code-review/start"]);
  });

  it("starts nothing for a plain comment", async () => {
    const { deliver, requests } = scene();

    await deliver("github.issue_comment.created", {
      comment_author: "gedaiu",
      comment_body: "looks fine to me",
    });

    expect(requests).toEqual([]);
  });

  it("starts nothing when the lore bot comments @lore review", async () => {
    const { deliver, requests } = scene();

    await deliver("github.pull_request_review_comment.created", {
      comment_author: "lore[bot]",
      comment_body: "@lore review",
    });

    expect(requests).toEqual([]);
  });

  it("starts code-review-reply for a MEMBER's request-changes review 99", async () => {
    const { deliver, requests } = scene();

    await deliver("github.pull_request_review.submitted", {
      review_id: 99,
      review_state: "changes_requested",
      review_author: "gedaiu",
      review_author_association: "MEMBER",
    });

    expect(writes(requests)).toEqual([
      "/assembly-lines/code-review-reply/start",
    ]);
  });

  it("starts nothing for a request-changes review from a stranger with association NONE", async () => {
    const { deliver, requests } = scene();

    await deliver("github.pull_request_review.submitted", {
      review_id: 99,
      review_state: "changes_requested",
      review_author: "stranger",
      review_author_association: "NONE",
    });

    expect(requests).toEqual([]);
  });

  it("starts nothing for an approving review", async () => {
    const { deliver, requests } = scene();

    await deliver("github.pull_request_review.submitted", {
      review_id: 99,
      review_state: "approved",
      review_author: "gedaiu",
      review_author_association: "OWNER",
    });

    expect(requests).toEqual([]);
  });

  it("cancels the open review of a closed pull request even with auto_review off", async () => {
    const { deliver, requests } = scene({
      autoReview: false,
      runs: [OPEN_REVIEW_RUN],
    });

    await deliver("github.pull_request.closed", {});

    expect(writes(requests)).toEqual(["/assembly-runs/open-1/cancel"]);
  });
});
