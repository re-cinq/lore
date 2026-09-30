import { describe, expect, it } from "vitest";
import type { RunView } from "@re-cinq/floor-client";
import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import type {
  PullCommit,
  PullRef,
} from "../../outbound/project/pulls/pull-requests-port.js";
import {
  recordedFloor,
  type FloorRequest,
} from "../../outbound/floor/recorded-floor.js";
import {
  closeReviewsForPr,
  issueMarkdown,
  reviewOrRecheck,
  startReply,
  startReview,
  type ReviewStartDeps,
} from "./floor-review-start.js";
import { openFloorReviewCount } from "./floor-review-runs.js";

const PR_URL = "https://github.com/re-cinq/lore/pull/412";
const TARGET = { repo: "re-cinq/lore", prNumber: 412, autoReview: true };

function pull(overrides: Partial<PullRef> = {}): PullRef {
  return {
    repo: "re-cinq/lore",
    number: 412,
    title: "Fix the login",
    branch: "fix/login",
    state: "open",
    labels: [],
    url: PR_URL,
    author: "gedaiu",
    draft: false,
    headSha: "sha-new",
    body: "",
    ...overrides,
  };
}

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "run-1",
    lineId: "code-review",
    lineHash: "hash",
    repo: "github.com/re-cinq/lore",
    subjectKey: `pr_url:${PR_URL}`,
    startItems: {
      pr_url: { kind: "value", ref: PR_URL, by: "lore" },
      head_sha: { kind: "value", ref: "sha-old", by: "lore" },
    },
    outcome: "success",
    reason: null,
    finishedAt: "2026-09-30T10:00:00.000Z",
    ...overrides,
  };
}

interface Scene {
  pr?: PullRef | null;
  runs?: RunView[];
  joined?: boolean;
  commits?: PullCommit[];
  issue?: IssueRef | null;
}

function scene(given: Scene = {}) {
  const comments: string[] = [];
  const recorded = recordedFloor((request) => answerOf(request, given));
  const deps: ReviewStartDeps = {
    floor: recorded.floor,
    pulls: {
      get: () => Promise.resolve(given.pr === undefined ? pull() : given.pr),
      comment: (_number, body) => {
        comments.push(body);

        return Promise.resolve();
      },
      listCommits: () => Promise.resolve(given.commits ?? []),
    },
    issues: { get: () => Promise.resolve(given.issue ?? null) },
    uiUrl: "https://lore.test/",
  };

  return { deps, requests: recorded.requests, comments };
}

function answerOf(request: FloorRequest, given: Scene): unknown {
  if (request.path.startsWith("/assembly-runs?")) {
    return { items: given.runs ?? [], nextCursor: null };
  }

  if (request.path === "/blobs") {
    return { hash: "blob-1", size: 10 };
  }

  if (request.path.endsWith("/cancel")) {
    return run({ outcome: "cancelled" });
  }

  return { run: run({ id: "run-new" }), joined: given.joined ?? false };
}

function started(requests: FloorRequest[]): FloorRequest[] {
  return requests.filter((request) => request.path.endsWith("/start"));
}

describe("startReview", () => {
  it("starts code-review on the pull request's branch with its url, description and head sha", async () => {
    const { deps, requests } = scene();

    await startReview(deps, TARGET);

    expect(started(requests)).toEqual([
      {
        method: "POST",
        path: "/assembly-lines/code-review/start",
        body: {
          repo: "github.com/re-cinq/lore",
          startItems: {
            repo: {
              kind: "git",
              ref: "github.com/re-cinq/lore@fix/login",
              by: "lore",
            },
            pr_url: { kind: "value", ref: PR_URL, by: "lore" },
            description: {
              kind: "value",
              ref: "Review pull request #412 in re-cinq/lore (branch fix/login).",
              by: "lore",
            },
            head_sha: { kind: "value", ref: "sha-new", by: "lore" },
          },
        },
      },
    ]);
  });

  it("announces run-new with a link to its run page", async () => {
    const { deps, comments } = scene();

    await startReview(deps, TARGET);

    expect(comments[0]).toContain(
      "Lore is reviewing this PR — [run-new](https://lore.test/assembly-runs/run-new).",
    );
  });

  it("posts no announcement for a review it joined", async () => {
    const { deps, comments } = scene({ joined: true });

    await startReview(deps, TARGET);

    expect(comments).toEqual([]);
  });

  it("starts nothing for a draft pull request", async () => {
    const { deps, requests } = scene({ pr: pull({ draft: true }) });

    expect(await startReview(deps, TARGET)).toBeNull();
    expect(started(requests)).toEqual([]);
  });

  it("stores issue 12 as a file and passes it when the body says Closes #12", async () => {
    const { deps, requests } = scene({
      pr: pull({ body: "Fixes the form.\n\nCloses #12" }),
      issue: {
        repo: "re-cinq/lore",
        number: 12,
        title: "Login fails",
        state: "open",
        labels: [],
        body: "Steps to reproduce.",
      },
    });

    await startReview(deps, TARGET);

    expect(requests.find((r) => r.path === "/blobs")?.body).toBe(
      "# Login fails (#12)\n\nSteps to reproduce.\n",
    );
    expect(started(requests)[0].body).toMatchObject({
      startItems: { issue: { kind: "file", ref: "blob-1", by: "lore" } },
    });
  });

  it("passes no issue when the pull request names none", async () => {
    const { deps, requests } = scene();

    await startReview(deps, TARGET);

    expect(started(requests)[0].body).not.toHaveProperty("startItems.issue");
  });

  it("cancels the open re-check as superseded when a review is forced", async () => {
    const { deps, requests } = scene({
      runs: [
        run({
          id: "recheck-1",
          lineId: "code-review-recheck",
          finishedAt: null,
        }),
      ],
    });

    await startReview(deps, { ...TARGET, forced: true });

    expect(requests).toContainEqual({
      method: "POST",
      path: "/assembly-runs/recheck-1/cancel",
      body: { reason: "superseded" },
    });
  });
});

describe("reviewOrRecheck", () => {
  it("starts code-review for a pull request no review has run on", async () => {
    const { deps, requests } = scene();

    await reviewOrRecheck(deps, TARGET);

    expect(started(requests).map((r) => r.path)).toEqual([
      "/assembly-lines/code-review/start",
    ]);
  });

  it("starts a re-check that names sha-old as the last judged commit", async () => {
    const { deps, requests } = scene({
      runs: [run()],
      commits: [
        { sha: "sha-old", message: "first", date: "2026-09-30T09:00:00Z" },
        { sha: "sha-new", message: "second", date: "2026-09-30T09:30:00Z" },
      ],
    });

    await reviewOrRecheck(deps, TARGET);

    expect(started(requests)[0]).toMatchObject({
      path: "/assembly-lines/code-review-recheck/start",
      body: {
        startItems: {
          description: {
            ref: expect.stringContaining(
              "diff --no-ext-diff sha-old..HEAD",
            ) as string,
          },
        },
      },
    });
  });

  it("names no sha after a rebase dropped sha-old from the branch, so the re-check reads the whole pull request", async () => {
    const { deps, requests } = scene({
      runs: [run()],
      commits: [
        { sha: "sha-rebased", message: "first", date: "2026-09-30T09:00:00Z" },
      ],
    });

    await reviewOrRecheck(deps, TARGET);

    expect(started(requests)[0].body).toMatchObject({
      startItems: {
        description: {
          ref: "Re-check pull request #412 in re-cinq/lore (branch fix/login) after a new push.",
        },
      },
    });
  });

  it("starts no re-check on a pull request the lore bot authored", async () => {
    const { deps, requests } = scene({
      pr: pull({ author: "lore[bot]" }),
      runs: [run()],
    });

    expect(await reviewOrRecheck(deps, TARGET)).toBeNull();
    expect(started(requests)).toEqual([]);
  });

  it("starts no re-check while an open run is judging sha-new", async () => {
    const { deps, requests } = scene({
      runs: [
        run({
          finishedAt: null,
          startItems: {
            pr_url: { kind: "value", ref: PR_URL, by: "lore" },
            head_sha: { kind: "value", ref: "sha-new", by: "lore" },
          },
        }),
      ],
    });

    expect(await reviewOrRecheck(deps, TARGET)).toBeNull();
    expect(started(requests)).toEqual([]);
  });

  it("ignores a review of another pull request in the same repository", async () => {
    const other = "https://github.com/re-cinq/lore/pull/7";
    const { deps, requests } = scene({
      runs: [
        run({
          startItems: { pr_url: { kind: "value", ref: other, by: "lore" } },
        }),
      ],
    });

    await reviewOrRecheck(deps, TARGET);

    expect(started(requests).map((r) => r.path)).toEqual([
      "/assembly-lines/code-review/start",
    ]);
  });
});

describe("startReply", () => {
  it("starts code-review-reply for review 99 with the address intent", async () => {
    const { deps, requests } = scene();

    await startReply(deps, { ...TARGET, reviewId: 99, reviewAuthor: "gedaiu" });

    expect(started(requests)[0]).toMatchObject({
      path: "/assembly-lines/code-review-reply/start",
      body: {
        startItems: {
          review_id: { kind: "value", ref: "99", by: "lore" },
          intent: { kind: "value", ref: "address", by: "lore" },
        },
      },
    });
  });

  it("starts no reply for a review the lore bot submitted", async () => {
    const { deps, requests } = scene();
    const replied = await startReply(deps, {
      ...TARGET,
      reviewId: 99,
      reviewAuthor: "lore[bot]",
    });

    expect(replied).toBeNull();
    expect(started(requests)).toEqual([]);
  });
});

describe("openFloorReviewCount", () => {
  it("counts the 1 open run of pull request 412 and not the finished one", async () => {
    const { deps } = scene({
      runs: [run({ id: "open-1", finishedAt: null }), run({ id: "done-1" })],
    });

    expect(await openFloorReviewCount(deps.floor, TARGET)).toBe(1);
  });

  it("counts 0 on a deployment with no floor", async () => {
    expect(await openFloorReviewCount(null, TARGET)).toBe(0);
  });
});

describe("closeReviewsForPr", () => {
  it("cancels the open runs of pull request 412 as pr_closed and leaves the finished one", async () => {
    const { deps, requests } = scene({
      runs: [run({ id: "open-1", finishedAt: null }), run({ id: "done-1" })],
    });

    expect(await closeReviewsForPr(deps.floor, TARGET)).toEqual(["open-1"]);
    expect(requests.filter((r) => r.path.endsWith("/cancel"))).toEqual([
      {
        method: "POST",
        path: "/assembly-runs/open-1/cancel",
        body: { reason: "pr_closed" },
      },
    ]);
  });
});

describe("issueMarkdown", () => {
  it("writes an issue with no body as its title alone", () => {
    expect(
      issueMarkdown({
        repo: "re-cinq/lore",
        number: 3,
        title: "Empty",
        state: "open",
        labels: [],
      }),
    ).toBe("# Empty (#3)\n\n\n");
  });
});
