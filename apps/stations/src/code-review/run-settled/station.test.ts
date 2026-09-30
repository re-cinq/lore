import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { RunView } from "@re-cinq/floor-client";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { CreateReviewInput } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { runSettledHandle, type RunSettledDeps } from "./station.js";
import type { FailedAgentVisit } from "./run-settled.js";

const PR_URL = "https://github.com/re-cinq/lore/pull/412";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

function brokenRun(headSha?: string): RunView {
  return {
    id: "run-1",
    lineId: "code-review",
    lineHash: "hash",
    repo: "github.com/re-cinq/lore",
    subjectKey: null,
    startItems: {
      pr_url: { kind: "value", ref: PR_URL, by: "lore" },
      ...(headSha
        ? { head_sha: { kind: "value", ref: headSha, by: "lore" } }
        : {}),
    },
    createdAt: "2026-09-30T09:00:00.000Z",
    outcome: "error",
    reason: "post-review: failed",
    finishedAt: "2026-09-30T10:00:00.000Z",
  };
}

const OUT_OF_QUOTA: FailedAgentVisit = {
  visitId: "visit-agent",
  iteration: 2,
  error:
    "429 You exceeded your current quota, please check your plan and billing details.",
  model: "gemini-3.1-pro-preview",
};

function scene(
  settled: RunView | null,
  pullHeadSha?: string,
  failure: FailedAgentVisit | null = null,
  refusedEvent?: CreateReviewInput["event"],
) {
  const checks: CheckRunInput[] = [];
  const repos: string[] = [];
  const reviews: CreateReviewInput[] = [];
  const deps: RunSettledDeps = {
    run: () => Promise.resolve(settled),
    failedAgentVisit: () => Promise.resolve(failure),
    project: (repo) => {
      repos.push(repo);

      return Promise.resolve({
        createReview: (_number, input) => {
          if (input.event === refusedEvent) {
            return Promise.reject(
              new Error("Can not approve your own pull request"),
            );
          }
          reviews.push(input);

          return Promise.resolve();
        },
        listReviews: () =>
          Promise.resolve(
            reviews.map((review, index) => ({
              id: index,
              state: review.event,
              body: review.body ?? "",
              user: "lore[bot]",
              submitted_at: "2026-09-30T10:00:00Z",
            })),
          ),
        listIssueComments: () => Promise.resolve([]),
        pullHead: () => Promise.resolve({ headSha: pullHeadSha }),
        upsertCheckRun: (input) => {
          checks.push(input);

          return Promise.resolve();
        },
      });
    },
  };

  return { handle: runSettledHandle(deps), checks, repos, reviews };
}

function brief(lineId: string, outcome: string) {
  return {
    visitId: "visit-1",
    iteration: 1,
    needs: { run_id: "run-1", line_id: lineId, outcome },
  };
}

describe("runSettledHandle", () => {
  it("fails the check on sha-1 of re-cinq/lore for a code-review run settled as error", async () => {
    const { handle, checks, repos } = scene(brokenRun("sha-1"));

    await handle(brief("code-review", "error"), TOOLS);

    expect(repos).toEqual(["re-cinq/lore"]);
    expect(checks).toMatchObject([{ headSha: "sha-1", conclusion: "failure" }]);
  });

  it("reads the head sha off the pull request when the run was started without one", async () => {
    const { handle, checks } = scene(brokenRun(), "sha-live");

    await handle(brief("code-review", "error"), TOOLS);

    expect(checks).toMatchObject([{ headSha: "sha-live" }]);
  });

  it("publishes nothing for a code-review run settled as success", async () => {
    const { handle, checks } = scene(brokenRun("sha-1"));

    expect(await handle(brief("code-review", "success"), TOOLS)).toEqual({
      outcome: "success",
    });
    expect(checks).toEqual([]);
  });

  it("publishes nothing when the floor no longer has the run", async () => {
    const { handle, checks } = scene(null);

    await handle(brief("code-review", "error"), TOOLS);

    expect(checks).toEqual([]);
  });

  it("publishes nothing for a walk-note run settled as error", async () => {
    const { handle, checks } = scene(brokenRun("sha-1"));

    await handle(brief("walk-note", "error"), TOOLS);

    expect(checks).toEqual([]);
  });

  it("approves once with the budget notice and succeeds the check for a run whose agent ran out of quota", async () => {
    const { handle, checks, reviews } = scene(
      brokenRun("sha-1"),
      undefined,
      OUT_OF_QUOTA,
    );

    await handle(brief("code-review", "error"), TOOLS);

    expect(reviews).toMatchObject([{ event: "APPROVE", comments: [] }]);
    expect(checks).toMatchObject([{ headSha: "sha-1", conclusion: "success" }]);
  });

  it("signs the budget approval with the failed visit's identity line and marker", async () => {
    const { handle, reviews } = scene(
      brokenRun("sha-1"),
      undefined,
      OUT_OF_QUOTA,
    );

    await handle(brief("code-review", "error"), TOOLS);

    expect(reviews[0]?.body).toContain(
      "_Reviewer that would have run: `gemini-3.1-pro-preview`_",
    );
    expect(reviews[0]?.body).toMatch(
      /_Posted by floor, visit visit-agent\._\n\n<!-- lore-review-run: visit-agent\/2 -->$/,
    );
  });

  it("approves only once when the same run is delivered twice", async () => {
    const { handle, reviews } = scene(
      brokenRun("sha-1"),
      undefined,
      OUT_OF_QUOTA,
    );

    await handle(brief("code-review", "error"), TOOLS);
    await handle(brief("code-review", "error"), TOOLS);

    expect(reviews).toHaveLength(1);
  });

  it("posts the budget notice as a COMMENT review and succeeds the check when GitHub refuses the APPROVE", async () => {
    const { handle, checks, reviews } = scene(
      brokenRun("sha-1"),
      undefined,
      OUT_OF_QUOTA,
      "APPROVE",
    );

    await handle(brief("code-review", "error"), TOOLS);

    expect(reviews).toMatchObject([{ event: "COMMENT", comments: [] }]);
    expect(checks).toMatchObject([{ conclusion: "success" }]);
  });

  it("fails the check and posts no review for an agent that failed with a non-credit error", async () => {
    const failure = { ...OUT_OF_QUOTA, error: "OOMKilled" };
    const { handle, checks, reviews } = scene(
      brokenRun("sha-1"),
      undefined,
      failure,
    );

    await handle(brief("code-review", "error"), TOOLS);

    expect(reviews).toEqual([]);
    expect(checks).toMatchObject([{ conclusion: "failure" }]);
  });

  it("fails the check and posts no review when the run has no failed agent visit", async () => {
    const { handle, checks, reviews } = scene(brokenRun("sha-1"));

    await handle(brief("code-review", "error"), TOOLS);

    expect(reviews).toEqual([]);
    expect(checks).toMatchObject([{ conclusion: "failure" }]);
  });
});
