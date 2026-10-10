import { describe, expect, it } from "vitest";
import {
  recordedFloor,
  type FloorRequest,
} from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { FLOOR_RUN, FLOOR_VISIT } from "./floor-run.fixtures.js";
import { blobPreviews } from "./floor-run-blob.js";

const ISSUE = `sha256-${"a".repeat(64)}`;
const PLAN = `sha256-${"c".repeat(64)}`;
const STRANGER = `sha256-${"b".repeat(64)}`;
const MARKDOWN = "# Fix login (#412)\n";
const LONG_PLAN = "p".repeat(5000);

function floorHandingIssueAndPlan() {
  return recordedFloor((request: FloorRequest) => {
    const answers: Record<string, unknown> = {
      "/assembly-runs/run-1": { run: FLOOR_RUN, bag: {} },
      "/station-runs?run=run-1": {
        items: [
          {
            ...FLOOR_VISIT,
            brief: { needs: { issue: ISSUE, plan: PLAN }, iteration: 1 },
          },
        ],
      },
      [`/blobs/${ISSUE}`]: new Response(MARKDOWN, {
        headers: { "content-type": "text/markdown" },
      }),
      [`/blobs/${PLAN}`]: new Response(LONG_PLAN, {
        headers: { "content-type": "text/plain" },
      }),
      [`/blobs/${STRANGER}`]: new Response("not this run's"),
    };

    return answers[request.path];
  });
}

describe("blobPreviews", () => {
  it("previews the issue whole and the 5000-byte plan cut at 4 KiB, leaving out a hash the run never referenced", async () => {
    const { floor } = floorHandingIssueAndPlan();

    const previews = await blobPreviews(floor, "run-1", [
      ISSUE,
      PLAN,
      STRANGER,
    ]);

    expect(previews).toEqual({
      [ISSUE]: {
        hash: ISSUE,
        contentType: "text/markdown",
        size: MARKDOWN.length,
        text: MARKDOWN,
        truncated: false,
      },
      [PLAN]: {
        hash: PLAN,
        contentType: "text/plain",
        size: 5000,
        text: "p".repeat(4096),
        truncated: true,
      },
    });
  });

  it("reads the run and its visits once for two hashes", async () => {
    const recorded = floorHandingIssueAndPlan();

    await blobPreviews(recorded.floor, "run-1", [ISSUE, PLAN]);

    expect(recorded.requests.map((request) => request.path).sort()).toEqual([
      "/assembly-runs/run-1",
      `/blobs/${ISSUE}`,
      `/blobs/${PLAN}`,
      "/station-runs?run=run-1",
    ]);
  });

  it("answers null for a run the floor does not have", async () => {
    const { floor } = floorHandingIssueAndPlan();

    expect(await blobPreviews(floor, "run-9", [ISSUE])).toBeNull();
  });
});
