import { describe, expect, it } from "vitest";
import type { RunView } from "@re-cinq/floor-client";
import {
  recordedFloor,
  type FloorRequest,
} from "../../outbound/floor/recorded-floor.js";
import { hasReviewedPr, reviewRunsForPr } from "./floor-review-runs.js";

const PR_URL = "https://github.com/re-cinq/lore/pull/412";
const TARGET = { repo: "re-cinq/lore", prNumber: 412 };

function run(id: string, lineId: string, prUrl = PR_URL): RunView {
  return {
    id,
    lineId,
    lineHash: "hash",
    repo: "github.com/re-cinq/lore",
    subjectKey: `pr_url:${prUrl}`,
    startItems: { pr_url: { kind: "value", ref: prUrl, by: "lore" } },
    outcome: "success",
    reason: null,
    createdAt: "2026-10-23T06:28:00.000Z",
    finishedAt: "2026-10-23T06:40:00.000Z",
  };
}

function busyRepo(byLine: Record<string, RunView[]>) {
  return recordedFloor((request: FloorRequest) => {
    const query = new URLSearchParams(request.path.split("?")[1] ?? "");
    const line = query.get("line");
    const runs = line
      ? (byLine[line] ?? [])
      : Array.from({ length: 200 }, (_, i) =>
          run(
            `other-${i}`,
            "auto-merge",
            `https://github.com/re-cinq/lore/pull/${i}`,
          ),
        );

    return { items: runs, nextCursor: null };
  });
}

describe("reviewRunsForPr", () => {
  it("finds the code-review of #412 from yesterday morning though the repository's 200 newest runs are another line's", async () => {
    const recorded = busyRepo({
      "code-review": [run("review-1", "code-review")],
    });

    expect(await hasReviewedPr(recorded.floor, TARGET)).toBe(true);
  });

  it("reads #412's re-checks and replies from their own lines, leaving another pull request's out", async () => {
    const recorded = busyRepo({
      "code-review-recheck": [
        run("recheck-1", "code-review-recheck"),
        run(
          "recheck-9",
          "code-review-recheck",
          "https://github.com/re-cinq/lore/pull/9",
        ),
      ],
      "code-review-reply": [run("reply-1", "code-review-reply")],
    });

    expect(
      (await reviewRunsForPr(recorded.floor, TARGET))
        .map((found) => found.id)
        .sort(),
    ).toEqual(["recheck-1", "reply-1"]);
  });
});
