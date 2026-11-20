import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { startIngestHandle, type StartIngestTarget } from "./station.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const BRIEF = {
  visitId: "visit-start-ingest",
  iteration: 1,
  needs: {
    target: "https://github.com/re-cinq/app@lore/onboard/app-1234abcd",
    task_id: "task-1",
  },
};

describe("the onboard-start-ingest station", () => {
  it("starts the first ingestion of re-cinq/app for task task-1 and reports success", async () => {
    const started: StartIngestTarget[] = [];
    const handle = startIngestHandle({
      startIngest: (target) => {
        started.push(target);

        return Promise.resolve({ started: ["lore-ingest.yml"], gaps: [] });
      },
    });

    expect(await handle(BRIEF, TOOLS)).toEqual({ outcome: "success" });
    expect(started).toEqual([{ repo: "re-cinq/app", taskId: "task-1" }]);
  });

  it("reports success when lore-tests.yml could not be started, because the gap is audited, not retried", async () => {
    const handle = startIngestHandle({
      startIngest: () =>
        Promise.resolve({
          started: ["lore-ingest.yml"],
          gaps: [{ step: "lore-tests.yml", error: "Not Found" }],
        }),
    });

    expect(await handle(BRIEF, TOOLS)).toEqual({ outcome: "success" });
  });

  it("reports failed with the error when starting the ingestion throws", async () => {
    const handle = startIngestHandle({
      startIngest: () => Promise.reject(new Error("github unreachable")),
    });

    expect(await handle(BRIEF, TOOLS)).toEqual({
      outcome: "failed",
      error: "github unreachable",
    });
  });
});
