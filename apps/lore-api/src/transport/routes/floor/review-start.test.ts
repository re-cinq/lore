import { describe, expect, it } from "vitest";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  AUTO_MERGE_SUBJECT,
  autoMergeStartItems,
  floorRepoOf,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import {
  oneOpenRunPerSubject,
  recordedFloor,
  type RecordedFloor,
} from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { handleReviewStart } from "./review-start.js";

const PULL: PullRef = {
  repo: "re-cinq/lore",
  number: 412,
  title: "Fix the login",
  branch: "fix/login",
  state: "open",
  labels: [],
  url: "https://github.com/re-cinq/lore/pull/412",
  draft: true,
  headSha: "sha-new",
};

function scene(
  pull: PullRef | null,
  recorded: RecordedFloor = recordedFloor((request) =>
    request.path.startsWith("/assembly-runs?")
      ? { items: [], nextCursor: null }
      : { run: { id: "run-new" }, joined: true },
  ),
) {
  const comments: string[] = [];
  const depsFor = () =>
    Promise.resolve({
      floor: recorded.floor,
      pulls: {
        get: () => Promise.resolve(pull),
        comment: (_number: number, body: string) => {
          comments.push(body);

          return Promise.resolve();
        },
        listCommits: () => Promise.resolve([]),
        listReviews: () => Promise.resolve([]),
        listComments: () => Promise.resolve([]),
        listReviewThreads: () => Promise.resolve([]),
        listChecks: () => Promise.resolve([]),
        netChange: () => Promise.resolve(null),
      },
      issues: { get: () => Promise.resolve(null) },
      checks: { upsertCheckRun: () => Promise.resolve() },
    });

  return { depsFor, requests: recorded.requests, comments };
}

describe("handleReviewStart", () => {
  it("starts code-review for draft pull request 412, since a click is forced past the gate", async () => {
    const { depsFor, requests } = scene(PULL);
    const answer = await handleReviewStart(depsFor, {
      repo: "re-cinq/lore",
      pr_number: 412,
    });

    expect(answer).toEqual({ started: "run-new" });
    expect(requests.map((request) => request.path)).toContain(
      "/assembly-lines/code-review/start",
    );
  });

  it("starts and announces code-review for pull request 412 while its auto-merge run waits", async () => {
    const recorded = oneOpenRunPerSubject((line) =>
      line === "auto-merge" ? AUTO_MERGE_SUBJECT : "pr_url",
    );
    const { depsFor, comments } = scene(PULL, recorded);

    await recorded.floor.lines.start("auto-merge", {
      repo: floorRepoOf(PULL.repo),
      startItems: autoMergeStartItems(PULL.repo, PULL),
    });
    const answer = await handleReviewStart(depsFor, {
      repo: "re-cinq/lore",
      pr_number: 412,
    });

    expect({
      answer,
      announced: comments.map((body) => body.split("\n")[0]),
    }).toEqual({
      answer: { started: "run-on-code-review" },
      announced: ["Lore is reviewing this PR — run-on-code-review."],
    });
  });

  it("answers null and starts nothing for a closed pull request", async () => {
    const { depsFor, requests } = scene({ ...PULL, state: "closed" });
    const answer = await handleReviewStart(depsFor, {
      repo: "re-cinq/lore",
      pr_number: 412,
    });

    expect(answer).toEqual({ started: null });
    expect(requests).toEqual([]);
  });
});
