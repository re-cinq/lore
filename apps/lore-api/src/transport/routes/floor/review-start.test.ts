import { describe, expect, it } from "vitest";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { recordedFloor } from "@re-cinq/lore-shared/floor/recorded-floor.js";
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

function scene(pull: PullRef | null) {
  const recorded = recordedFloor((request) =>
    request.path.startsWith("/assembly-runs?")
      ? { items: [], nextCursor: null }
      : { run: { id: "run-new" }, joined: true },
  );
  const depsFor = () =>
    Promise.resolve({
      floor: recorded.floor,
      pulls: {
        get: () => Promise.resolve(pull),
        comment: () => Promise.resolve(),
        listCommits: () => Promise.resolve([]),
      },
      issues: { get: () => Promise.resolve(null) },
    });

  return { depsFor, requests: recorded.requests };
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
