import { describe, expect, it } from "vitest";
import { recordedFloor } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { FloorRunReader } from "./floor-run-reader.js";
import { FloorRunRows } from "./floor-run-rows.js";
import { floorWithRunPage, PR_URL } from "./floor-run.fixtures.js";

describe("FloorRunRows", () => {
  it("answers a page of runs as wire rows with the pull request, cost, pipeline and next cursor", async () => {
    const reader = new FloorRunReader(recordedFloor(floorWithRunPage).floor);

    expect(await new FloorRunRows(reader).page({})).toMatchObject({
      runs: [
        {
          id: "run-1",
          blueprint_name: "code-review",
          engine: "floor",
          status: "running",
          pr_url: PR_URL,
          cost_usd: 0.42,
          pipeline: [
            { node_id: "review", state: "running" },
            { node_id: "done", state: "pending" },
          ],
        },
      ],
      next_cursor: "cursor-2",
    });
  });
});
