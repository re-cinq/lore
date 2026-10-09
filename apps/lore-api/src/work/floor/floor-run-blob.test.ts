import { describe, expect, it } from "vitest";
import {
  recordedFloor,
  type FloorRequest,
} from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { FLOOR_RUN, FLOOR_VISIT } from "./floor-run.fixtures.js";
import { runBlob } from "./floor-run-blob.js";

const HELD = `sha256-${"a".repeat(64)}`;
const OTHER = `sha256-${"b".repeat(64)}`;
const MARKDOWN = "# Fix login (#412)\n\nThe form posts twice.\n";

function floorHolding(visitOver: Partial<typeof FLOOR_VISIT> = {}) {
  const visit = { ...FLOOR_VISIT, ...visitOver };

  return recordedFloor((request: FloorRequest) => {
    const answers: Record<string, unknown> = {
      "/assembly-runs/run-1": { run: FLOOR_RUN, bag: {} },
      "/station-runs?run=run-1": { items: [visit] },
      [`/blobs/${HELD}`]: new Response(MARKDOWN, {
        headers: { "content-type": "text/markdown" },
      }),
      [`/blobs/${OTHER}`]: new Response("not this run's"),
    };

    return answers[request.path];
  }).floor;
}

const handedIssue = {
  brief: { needs: { issue: HELD, pr_url: "https://x/pull/1" }, iteration: 1 },
};

describe("runBlob", () => {
  it("answers the markdown a visit was handed as its issue need", async () => {
    expect(await runBlob(floorHolding(handedIssue), "run-1", HELD)).toEqual({
      hash: HELD,
      contentType: "text/markdown",
      size: MARKDOWN.length,
      text: MARKDOWN,
      truncated: false,
    });
  });

  it("answers a blob a visit reported as produced", async () => {
    const produced = {
      report: { outcome: "success", produced: { out: HELD } },
    };

    expect(await runBlob(floorHolding(produced), "run-1", HELD)).toMatchObject({
      hash: HELD,
      text: MARKDOWN,
    });
  });

  it("answers a blob the run was started with", async () => {
    const startedWith = recordedFloor((request: FloorRequest) => {
      const answers: Record<string, unknown> = {
        "/assembly-runs/run-1": {
          run: {
            ...FLOOR_RUN,
            startItems: { issue: { kind: "file", ref: HELD, by: "lore" } },
          },
          bag: {},
        },
        "/station-runs?run=run-1": { items: [] },
        [`/blobs/${HELD}`]: new Response(MARKDOWN, {
          headers: { "content-type": "text/markdown" },
        }),
      };

      return answers[request.path];
    }).floor;

    expect(await runBlob(startedWith, "run-1", HELD)).toMatchObject({
      text: MARKDOWN,
    });
  });

  it("answers null for a blob no visit of the run references, though the floor holds it", async () => {
    expect(await runBlob(floorHolding(handedIssue), "run-1", OTHER)).toBeNull();
  });

  it("answers null for a run the floor does not have", async () => {
    expect(await runBlob(floorHolding(handedIssue), "run-9", HELD)).toBeNull();
  });

  it("answers no text for a binary blob", async () => {
    const binary = recordedFloor((request: FloorRequest) => {
      const answers: Record<string, unknown> = {
        "/assembly-runs/run-1": { run: FLOOR_RUN, bag: {} },
        "/station-runs?run=run-1": {
          items: [{ ...FLOOR_VISIT, ...handedIssue }],
        },
        [`/blobs/${HELD}`]: new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png" },
        }),
      };

      return answers[request.path];
    }).floor;

    expect(await runBlob(binary, "run-1", HELD)).toEqual({
      hash: HELD,
      contentType: "image/png",
      size: 4,
      text: null,
      truncated: false,
    });
  });

  it("cuts a text blob over one mebibyte and says so", async () => {
    const big = "x".repeat(1_048_576 + 10);
    const floor = recordedFloor((request: FloorRequest) => {
      const answers: Record<string, unknown> = {
        "/assembly-runs/run-1": { run: FLOOR_RUN, bag: {} },
        "/station-runs?run=run-1": {
          items: [{ ...FLOOR_VISIT, ...handedIssue }],
        },
        [`/blobs/${HELD}`]: new Response(big, {
          headers: { "content-type": "text/plain" },
        }),
      };

      return answers[request.path];
    }).floor;
    const blob = await runBlob(floor, "run-1", HELD);

    expect({ length: blob?.text?.length, truncated: blob?.truncated }).toEqual({
      length: 1_048_576,
      truncated: true,
    });
  });
});
