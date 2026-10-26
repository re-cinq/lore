import { describe, expect, it } from "vitest";
import type { RunView } from "@re-cinq/floor-client";
import type {
  CheckRunInput,
  IssueRef,
} from "../../outbound/project/lib/github-port.js";
import type {
  CheckRun,
  FileChangeSummary,
  PullCommit,
  PullRef,
  PullReview,
  ReviewComment,
  ReviewThread,
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
    createdAt: "2026-09-30T09:00:00.000Z",
    finishedAt: "2026-09-30T10:00:00.000Z",
    ...overrides,
  };
}

function judging(sha: string): RunView["startItems"] {
  return {
    pr_url: { kind: "value", ref: PR_URL, by: "lore" },
    head_sha: { kind: "value", ref: sha, by: "lore" },
  };
}

interface Scene {
  pr?: PullRef | null;
  runs?: RunView[];
  runsByRead?: RunView[][];
  joined?: boolean;
  commits?: PullCommit[];
  issue?: IssueRef | null;
  reviews?: PullReview[];
  inlineComments?: ReviewComment[];
  threads?: ReviewThread[];
  checks?: Record<string, CheckRun[]>;
  netChanges?: Record<string, FileChangeSummary[] | null>;
}

function scene(given: Scene = {}) {
  const comments: string[] = [];
  const published: CheckRunInput[] = [];
  const reads: RunView[][] = [...(given.runsByRead ?? [])];
  const recorded = recordedFloor((request) =>
    answerOf(request, {
      ...given,
      runs: reads.length > 1 ? reads.shift() : (reads[0] ?? given.runs),
    }),
  );
  const deps: ReviewStartDeps = {
    floor: recorded.floor,
    pulls: {
      get: () => Promise.resolve(given.pr === undefined ? pull() : given.pr),
      comment: (_number, body) => {
        comments.push(body);

        return Promise.resolve();
      },
      listCommits: () => Promise.resolve(given.commits ?? []),
      listReviews: () => Promise.resolve(given.reviews ?? []),
      listComments: () => Promise.resolve(given.inlineComments ?? []),
      listReviewThreads: () => Promise.resolve(given.threads ?? []),
      listChecks: (ref) => Promise.resolve(given.checks?.[ref] ?? []),
      netChange: (_base, head) =>
        Promise.resolve(given.netChanges?.[head] ?? null),
    },
    checks: {
      upsertCheckRun: (input) => {
        published.push(input);

        return Promise.resolve();
      },
    },
    issues: { get: () => Promise.resolve(given.issue ?? null) },
    uiUrl: "https://lore.test/",
  };

  return { deps, requests: recorded.requests, comments, published };
}

function answerOf(request: FloorRequest, given: Scene): unknown {
  if (request.path.startsWith("/assembly-runs?")) {
    return { items: onLine(request, given.runs ?? []), nextCursor: null };
  }

  if (request.path === "/blobs") {
    return { hash: "blob-1", size: 10 };
  }

  if (request.path.endsWith("/cancel")) {
    return run({ outcome: "cancelled" });
  }

  return { run: run({ id: "run-new" }), joined: given.joined ?? false };
}

function onLine(request: FloorRequest, runs: RunView[]): RunView[] {
  const line = new URLSearchParams(request.path.split("?")[1]).get("line");

  return line ? runs.filter((r) => r.lineId === line) : runs;
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
              ref: 'repo: "re-cinq/lore"\nReview pull request #412 in re-cinq/lore (branch fix/login).',
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

  it("cancels the open re-check of sha-old as superseded when sha-new is pushed, before starting the new one", async () => {
    const { deps, requests } = scene({
      runs: [
        run({
          id: "recheck-old",
          lineId: "code-review-recheck",
          finishedAt: null,
        }),
        run(),
      ],
      commits: [
        { sha: "sha-old", message: "first", date: "2026-09-30T09:00:00Z" },
        { sha: "sha-new", message: "second", date: "2026-09-30T09:30:00Z" },
      ],
    });

    await reviewOrRecheck(deps, TARGET);

    expect(
      requests
        .map((r) => r.path)
        .filter((p) => !p.startsWith("/assembly-runs?")),
    ).toEqual([
      "/assembly-runs/recheck-old/cancel",
      "/assembly-lines/code-review-recheck/start",
    ]);
  });

  it("leaves a re-check of sha-new that opened between its reads alone, so a second delivery of the same push joins it", async () => {
    const recheckNew = run({
      id: "recheck-new",
      lineId: "code-review-recheck",
      finishedAt: null,
      startItems: {
        pr_url: { kind: "value", ref: PR_URL, by: "lore" },
        head_sha: { kind: "value", ref: "sha-new", by: "lore" },
      },
    });
    const { deps, requests } = scene({
      runsByRead: [[run()], [run()], [recheckNew, run()]],
      commits: [
        { sha: "sha-old", message: "first", date: "2026-09-30T09:00:00Z" },
        { sha: "sha-new", message: "second", date: "2026-09-30T09:30:00Z" },
      ],
    });

    await reviewOrRecheck(deps, TARGET);

    expect(requests.filter((r) => r.path.endsWith("/cancel"))).toEqual([]);
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
          ref: 'repo: "re-cinq/lore"\nRe-check pull request #412 in re-cinq/lore (branch fix/login) after a new push.',
        },
      },
    });
  });

  it("hands the re-check Lore's open finding on src/a.ts:12 in its brief and thread T1 as open_threads", async () => {
    const { deps, requests } = scene({
      runs: [run()],
      reviews: [
        {
          id: 5,
          state: "COMMENTED",
          body: "1 finding <!-- lore-review-run: v1/1 -->",
          user: "lore",
          submitted_at: "2026-09-30T10:00:00Z",
        },
      ],
      inlineComments: [
        {
          id: 50,
          path: "src/a.ts",
          line: 12,
          body: "the null check is inverted",
          user: "lore",
          created_at: "2026-09-30T10:00:00Z",
          review_id: 5,
        },
      ],
      threads: [
        {
          id: "T1",
          isResolved: false,
          isOutdated: false,
          comments: [{ databaseId: 50 }],
        },
      ],
    });

    await reviewOrRecheck(deps, TARGET);

    expect(started(requests)[0].body).toMatchObject({
      startItems: {
        description: {
          ref: expect.stringContaining(
            "- src/a.ts:12: the null check is inverted",
          ) as string,
        },
        open_threads: { kind: "value", ref: "T1" },
      },
    });
  });

  it("names sha-a, not sha-b, as the last judged commit when the re-check of sha-b was cancelled as superseded", async () => {
    const { deps, requests } = scene({
      runs: [
        run({
          id: "run-b",
          lineId: "code-review-recheck",
          outcome: "cancelled",
          reason: "superseded",
          startItems: judging("sha-b"),
        }),
        run({ id: "run-a", startItems: judging("sha-a") }),
      ],
      commits: [
        { sha: "sha-a", message: "first", date: "2026-09-30T09:00:00Z" },
        { sha: "sha-b", message: "second", date: "2026-09-30T09:30:00Z" },
        { sha: "sha-new", message: "third", date: "2026-09-30T09:31:00Z" },
      ],
    });

    await reviewOrRecheck(deps, TARGET);

    expect(started(requests)[0].body).toMatchObject({
      startItems: {
        description: {
          ref: expect.stringContaining(
            "diff --no-ext-diff sha-a..HEAD",
          ) as string,
        },
      },
    });
  });

  it("names no sha when the only review of the pull request failed, so the re-check reads the whole pull request", async () => {
    const { deps, requests } = scene({
      runs: [run({ outcome: "failed", reason: "agent failed twice" })],
      commits: [
        { sha: "sha-old", message: "first", date: "2026-09-30T09:00:00Z" },
        { sha: "sha-new", message: "second", date: "2026-09-30T09:30:00Z" },
      ],
    });

    await reviewOrRecheck(deps, TARGET);

    expect(started(requests)[0].body).toMatchObject({
      startItems: {
        description: {
          ref: 'repo: "re-cinq/lore"\nRe-check pull request #412 in re-cinq/lore (branch fix/login) after a new push.',
        },
      },
    });
  });

  it("names no sha while the first review of sha-old is still open, since it has posted no verdict", async () => {
    const { deps, requests } = scene({
      runs: [run({ outcome: null, finishedAt: null })],
      commits: [
        { sha: "sha-old", message: "first", date: "2026-09-30T09:00:00Z" },
        { sha: "sha-new", message: "second", date: "2026-09-30T09:30:00Z" },
      ],
    });

    await reviewOrRecheck(deps, TARGET);

    expect(started(requests)[0].body).toMatchObject({
      startItems: {
        description: {
          ref: 'repo: "re-cinq/lore"\nRe-check pull request #412 in re-cinq/lore (branch fix/login) after a new push.',
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
  it("starts code-review-reply for review 99 with the repository, the pull request and the review, and no intent: the agent reads what each comment asks", async () => {
    const { deps, requests } = scene();

    await startReply(deps, { ...TARGET, reviewId: 99, reviewAuthor: "gedaiu" });
    const { path, body } = started(requests)[0];
    const { startItems } = body as { startItems: Record<string, unknown> };

    expect({
      path,
      items: Object.keys(startItems),
      review: startItems.review_id,
    }).toEqual({
      path: "/assembly-lines/code-review-reply/start",
      items: ["repo", "pr_url", "review_id"],
      review: { kind: "value", ref: "99", by: "lore" },
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

const APPROVED_SHA_OLD = {
  "sha-old": [
    {
      id: 1,
      name: "lore/code-review",
      status: "completed",
      conclusion: "success",
    },
  ],
};

const LOGIN_CHANGE = [
  {
    filename: "src/login.ts",
    status: "modified",
    patch: "@@ -1,1 +1,2 @@\n ok\n+audit();",
  },
];

const REBASED = {
  runs: [run()],
  commits: [
    { sha: "sha-new", message: "Fix the login", date: "2026-09-30T11:00:00Z" },
  ],
};

describe("reviewOrRecheck after a rebase that changed nothing Lore reviewed", () => {
  it("carries sha-old's approval to sha-new as lore/code-review and starts no re-check, when the pull request changes the same lines at both (170 re-checks after a rebase-only push over the weekend of 2026-10-23, 149 with the same verdict)", async () => {
    const { deps, requests, published } = scene({
      ...REBASED,
      checks: APPROVED_SHA_OLD,
      netChanges: { "sha-old": LOGIN_CHANGE, "sha-new": LOGIN_CHANGE },
    });

    await reviewOrRecheck(deps, TARGET);

    expect({
      started: started(requests).length,
      published: published.map(({ headSha, name, conclusion }) => ({
        headSha,
        name,
        conclusion,
      })),
    }).toEqual({
      started: 0,
      published: [
        { headSha: "sha-new", name: "lore/code-review", conclusion: "success" },
      ],
    });
  });

  it("starts the re-check and carries nothing when the rebase changed a line, or when Lore did not approve sha-old", async () => {
    const outcomes = [];

    for (const given of [
      {
        checks: APPROVED_SHA_OLD,
        netChanges: {
          "sha-old": LOGIN_CHANGE,
          "sha-new": [{ ...LOGIN_CHANGE[0], patch: "@@ -1 +1 @@\n+other();" }],
        },
      },
      { netChanges: { "sha-old": LOGIN_CHANGE, "sha-new": LOGIN_CHANGE } },
    ]) {
      const { deps, requests, published } = scene({ ...REBASED, ...given });

      await reviewOrRecheck(deps, TARGET);
      outcomes.push({
        started: started(requests).length,
        published: published.length,
      });
    }

    expect(outcomes).toEqual([
      { started: 1, published: 0 },
      { started: 1, published: 0 },
    ]);
  });
});

const build = (status: string, conclusion: string | null): CheckRun => ({
  id: 9,
  name: "build",
  status,
  conclusion,
});

const PUSHED = {
  runs: [run()],
  commits: [
    { sha: "sha-old", message: "Fix the login", date: "2026-09-30T09:00:00Z" },
    { sha: "sha-new", message: "Guard the null", date: "2026-09-30T11:00:00Z" },
  ],
};

describe("reviewOrRecheck waiting for CI", () => {
  it("re-checks sha-new only once its CI is green, in a repository whose judged sha-old carried CI, and not while it runs or is red, since a red build brings another push", async () => {
    const outcomes = [];

    for (const head of [
      build("in_progress", null),
      build("completed", "failure"),
      build("completed", "success"),
    ]) {
      const { deps, requests } = scene({
        ...PUSHED,
        checks: {
          "sha-old": [build("completed", "success")],
          "sha-new": [head],
        },
      });

      await reviewOrRecheck(deps, TARGET);
      outcomes.push(started(requests).length);
    }

    expect(outcomes).toEqual([0, 0, 1]);
  });

  it("waits for CI that has not started on sha-new when sha-old carried CI, and re-checks at once in a repository whose judged sha carried none", async () => {
    const waits = scene({
      ...PUSHED,
      checks: { "sha-old": [build("completed", "success")] },
    });
    const noCi = scene(PUSHED);

    await reviewOrRecheck(waits.deps, TARGET);
    await reviewOrRecheck(noCi.deps, TARGET);

    expect([
      started(waits.requests).length,
      started(noCi.requests).length,
    ]).toEqual([0, 1]);
  });

  it("reads CI on the newest commit CI judged, not on a skip-ci commit at the head", async () => {
    const { deps, requests } = scene({
      runs: [run()],
      pr: pull({ headSha: "sha-fmt" }),
      commits: [
        ...PUSHED.commits,
        {
          sha: "sha-fmt",
          message: "style: prettier [skip ci]",
          date: "2026-09-30T11:01:00Z",
        },
      ],
      checks: {
        "sha-old": [build("completed", "success")],
        "sha-new": [build("completed", "success")],
      },
    });

    await reviewOrRecheck(deps, TARGET);

    expect(started(requests).length).toBe(1);
  });

  it("starts no second re-check of sha-new once a re-check of it finished, however many check suites complete on it", async () => {
    const { deps, requests } = scene({
      ...PUSHED,
      runs: [
        run(),
        run({
          id: "run-2",
          lineId: "code-review-recheck",
          startItems: judging("sha-new"),
        }),
      ],
    });

    await reviewOrRecheck(deps, TARGET);

    expect(started(requests).length).toBe(0);
  });
});

describe("reviewOrRecheck after a rebase that changed what Lore reviewed", () => {
  it("names the one file whose change differs from what sha-old's verdict judged, so the re-check reads only it", async () => {
    const { deps, requests } = scene({
      ...REBASED,
      checks: APPROVED_SHA_OLD,
      netChanges: {
        "sha-old": LOGIN_CHANGE,
        "sha-new": [
          ...LOGIN_CHANGE,
          {
            filename: "src/audit.ts",
            status: "added",
            patch: "@@ -0,0 +1 @@\n+log();",
          },
        ],
      },
    });

    await reviewOrRecheck(deps, TARGET);
    const body = started(requests)[0]?.body as {
      startItems: { description: { ref: string } };
    };

    expect(body.startItems.description.ref).toContain(
      "Lore's last verdict judged sha-old, which a rebase replaced. Since then the pull request's change differs only in `src/audit.ts`: read `git -C /workspace/target diff --no-ext-diff main...HEAD -- src/audit.ts` and judge only that.",
    );
  });
});

describe("reviewOrRecheck carrying an approval in a repository with CI", () => {
  it("carries sha-old's approval to sha-new while sha-new's CI still runs, since a rebase that changed nothing needs no wait, and does nothing again once the carried check stands on sha-new", async () => {
    const carry = scene({
      ...REBASED,
      checks: {
        "sha-old": [
          ...APPROVED_SHA_OLD["sha-old"],
          build("completed", "success"),
        ],
        "sha-new": [build("in_progress", null)],
      },
      netChanges: { "sha-old": LOGIN_CHANGE, "sha-new": LOGIN_CHANGE },
    });
    const again = scene({
      ...REBASED,
      checks: {
        "sha-old": [
          ...APPROVED_SHA_OLD["sha-old"],
          build("completed", "success"),
        ],
        "sha-new": [
          {
            id: 7,
            name: "lore/code-review",
            status: "completed",
            conclusion: "success",
          },
          build("completed", "success"),
        ],
      },
      netChanges: { "sha-old": LOGIN_CHANGE, "sha-new": LOGIN_CHANGE },
    });

    await reviewOrRecheck(carry.deps, TARGET);
    await reviewOrRecheck(again.deps, TARGET);

    expect({
      carried: carry.published.map((check) => check.headSha),
      again: [again.published.length, started(again.requests).length],
    }).toEqual({ carried: ["sha-new"], again: [0, 0] });
  });

  it("reads whether the repository runs CI from the commit CI judged at the last verdict, not from the skip-ci commit the last re-check ran on", async () => {
    const { deps, requests } = scene({
      runs: [run({ startItems: judging("sha-fmt") })],
      pr: pull({ headSha: "sha-next" }),
      commits: [
        {
          sha: "sha-new",
          message: "Guard the null",
          date: "2026-09-30T11:00:00Z",
        },
        {
          sha: "sha-fmt",
          message: "style: prettier [skip ci]",
          date: "2026-09-30T11:01:00Z",
        },
        { sha: "sha-next", message: "Log it", date: "2026-09-30T12:00:00Z" },
      ],
      checks: { "sha-new": [build("completed", "success")] },
    });

    await reviewOrRecheck(deps, TARGET);

    expect(started(requests).length).toBe(0);
  });
});
