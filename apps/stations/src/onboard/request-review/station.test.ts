import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { requestReviewHandle } from "./station.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const BRIEF = {
  visitId: "visit-review",
  iteration: 1,
  needs: { pr_url: "https://github.com/re-cinq/app/pull/42" },
};

describe("the onboard-request-review station", () => {
  it("starts a forced review of pull request 42 of re-cinq/app", async () => {
    const asked: unknown[] = [];
    const handle = requestReviewHandle({
      startReview: (target) => {
        asked.push(target);

        return Promise.resolve("run-review");
      },
    });

    expect(await handle(BRIEF, TOOLS)).toEqual({ outcome: "success" });
    expect(asked).toEqual([
      { repo: "re-cinq/app", prNumber: 42, autoReview: true, forced: true },
    ]);
  });

  it("reports failed with the error when the review cannot be started", async () => {
    const handle = requestReviewHandle({
      startReview: () => Promise.reject(new Error("floor unreachable")),
    });

    expect(await handle(BRIEF, TOOLS)).toEqual({
      outcome: "failed",
      error: "floor unreachable",
    });
  });
});
