import { describe, expect, it } from "vitest";
import {
  recordedFloor,
  type FloorRequest,
} from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { FLOOR_RUN } from "./floor-run.fixtures.js";
import { runBag } from "./floor-run-bag.js";

const HASH = `sha256-${"a".repeat(64)}`;
const BAG = {
  issue: { kind: "file", ref: HASH, by: "lore" },
  target: {
    kind: "git",
    ref: "github.com/re-cinq/lore@fix/login",
    by: "lore",
    sha: "9f2c1d4",
  },
  task_id: { kind: "value", ref: "task-1", by: "lore" },
} as const;

const floor = recordedFloor((request: FloorRequest) =>
  request.path === "/assembly-runs/run-1"
    ? { run: FLOOR_RUN, bag: BAG }
    : undefined,
).floor;

describe("runBag", () => {
  it("answers every item the floor holds in run-1's bag, kind, ref, author and sha", async () => {
    expect(await runBag(floor, "run-1")).toEqual(BAG);
  });

  it("answers null for a run the floor does not have", async () => {
    expect(await runBag(floor, "run-9")).toBeNull();
  });
});
