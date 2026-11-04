import { describe, expect, it } from "vitest";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  AUTO_MERGE_SUBJECT,
  autoMergeStartItems,
  floorRepoOf,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { oneOpenRunPerSubject } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { floorReviewHandlers } from "./floor-review-handlers.js";

const PULL: PullRef = {
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

describe("floorReviewHandlers with an auto-merge run waiting on the pull request", () => {
  it("starts and announces code-review when MEMBER gedaiu comments @lore review", async () => {
    const { floor, requests } = oneOpenRunPerSubject((line) =>
      line === "auto-merge" ? AUTO_MERGE_SUBJECT : "pr_url",
    );
    const comments: string[] = [];
    const handlers = floorReviewHandlers({
      autoReview: async () => true,
      review: () =>
        Promise.resolve({
          floor,
          pulls: {
            get: () => Promise.resolve(PULL),
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
        }),
    });

    await floor.lines.start("auto-merge", {
      repo: floorRepoOf(PULL.repo),
      startItems: autoMergeStartItems(PULL.repo, PULL),
    });
    await handlers.get("github.issue_comment.created")!({
      repo: PULL.repo,
      pr_number: PULL.number,
      comment_author: "gedaiu",
      comment_author_association: "MEMBER",
      comment_body: "@lore review",
    });

    expect({
      starts: requests
        .filter(({ path }) => path.endsWith("/start"))
        .map(({ path }) => path),
      announced: comments.map((body) => body.split("\n")[0]),
    }).toEqual({
      starts: [
        "/assembly-lines/auto-merge/start",
        "/assembly-lines/code-review/start",
      ],
      announced: ["Lore is reviewing this PR — run-on-code-review."],
    });
  });
});
