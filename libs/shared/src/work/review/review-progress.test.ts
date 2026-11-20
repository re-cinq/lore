import { expect, it } from "vitest";
import type {
  IssueComment,
  PullRef,
} from "../../outbound/project/pulls/pull-requests-port.js";
import {
  publishReviewProgress,
  REVIEW_PROGRESS_MARKER,
  type ReviewProgress,
  type ReviewProgressProject,
} from "./review-progress.js";

const opening: ReviewProgress = {
  prNumber: 42,
  headSha: "old-head",
  appLogin: "lore[bot]",
  runId: "first-run",
  startedAt: 1000,
  stage: 0,
  body: "Code reading",
};

const spoof: IssueComment = {
  id: 1,
  user: "maintainer",
  body: `${REVIEW_PROGRESS_MARKER}first-run 1000 0 -->\nCode reading`,
  created_at: "2026-11-19",
};

function github() {
  let headSha = "old-head";
  let writes = 0;
  const comments = [spoof];
  const project: ReviewProgressProject = {
    pulls: {
      async get(number): Promise<PullRef> {
        return {
          number,
          state: "open",
          headSha,
          repo: "acme/widget",
          url: "https://github.com/acme/widget/pull/42",
          branch: "example",
          title: "Review example",
          labels: [],
        };
      },
    },
    issues: {
      async listComments() {
        return [...comments];
      },
      async comment(_number, body) {
        writes++;
        comments.push({ ...spoof, id: 2, user: "lore[bot]", body });
        throw new Error("GitHub response lost");
      },
      async updateComment(id, body) {
        writes++;
        const index = comments.findIndex((comment) => comment.id === id);

        comments[index] = { ...comments[index], body };
      },
    },
  };

  return {
    project,
    comments,
    push: (sha: string) => {
      headSha = sha;
    },
    writes: () => writes,
  };
}

it("recovers a lost create response and reuses comment 2 across a retry, test reading and push", async () => {
  const { project, comments, push, writes } = github();

  await publishReviewProgress(project, opening);
  await publishReviewProgress(project, opening);
  await publishReviewProgress(project, {
    ...opening,
    stage: 1,
    body: "Code reading and test reading",
  });
  await publishReviewProgress(project, opening);
  push("new-head");
  await publishReviewProgress(project, {
    ...opening,
    headSha: "new-head",
    runId: "second-run",
    startedAt: 2000,
    body: "New code reading",
  });
  await publishReviewProgress(project, {
    ...opening,
    stage: 5,
    body: "Late result from old head",
  });

  expect({ comments, writes: writes() }).toEqual({
    comments: [
      spoof,
      {
        ...spoof,
        id: 2,
        user: "lore[bot]",
        body: `${REVIEW_PROGRESS_MARKER}second-run 2000 0 -->\nNew code reading`,
      },
    ],
    writes: 3,
  });
});

it("leaves the existing comment alone when the PR moves before publication", async () => {
  const { project, comments, push, writes } = github();

  await publishReviewProgress(project, opening);
  push("new-head");
  await publishReviewProgress(project, {
    ...opening,
    stage: 1,
    body: "Delayed test reading",
  });

  expect({ body: comments[1]?.body, writes: writes() }).toEqual({
    body: `${REVIEW_PROGRESS_MARKER}first-run 1000 0 -->\nCode reading`,
    writes: 1,
  });
});

it("replaces an earlier run on the same head while rejecting a late phase from that run", async () => {
  const { project, comments, writes } = github();

  await publishReviewProgress(project, opening);
  await publishReviewProgress(project, {
    ...opening,
    runId: "rerun",
    startedAt: 1001,
    body: "Rerun opening",
  });
  await publishReviewProgress(project, {
    ...opening,
    stage: 5,
    body: "Earlier run's verdict",
  });

  expect({ body: comments[1]?.body, writes: writes() }).toEqual({
    body: `${REVIEW_PROGRESS_MARKER}rerun 1001 0 -->\nRerun opening`,
    writes: 2,
  });
});
