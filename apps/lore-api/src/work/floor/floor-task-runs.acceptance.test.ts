import { describe, expect, it } from "vitest";
import { recordedFloor } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { FloorRunReader } from "./floor-run-reader.js";
import type { RunView } from "@re-cinq/floor-client";
import type { FloorRequest } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { FLOOR_RUN } from "./floor-run.fixtures.js";

function loopRunsInElevenPages(request: FloorRequest): unknown {
  const url = new URL(request.path, "http://floor.test");

  if (url.pathname === "/station-runs") {
    return { items: [] };
  }

  if (url.searchParams.get("line") !== "implementation-loop") {
    return { items: [], nextCursor: null };
  }

  const cursor = url.searchParams.get("cursor");
  const page = cursor ? parseInt(cursor.split("-")[1], 10) : 1;

  if (page < 11) {
    return {
      items: [loopRun(`run-task-page-${page}`, `task-page-${page}`)],
      nextCursor: `page-${page + 1}`,
    };
  }

  return {
    items: [loopRun("run-task-11", "task-11")],
    nextCursor: null,
  };
}

function loopRun(id: string, taskId: string): RunView {
  return {
    ...FLOOR_RUN,
    id,
    lineId: "implementation-loop",
    subjectKey: "backlog:tickets",
    startItems: { task_id: { kind: "value", ref: taskId, by: "lore" } },
  };
}

describe("FloorRunReader.taskRunContexts", () => {
  it("finds a task's run on page eleven of the line, walking past the first ten pages, asking no run by id", async () => {
    const recorded = recordedFloor(loopRunsInElevenPages);
    const found = await new FloorRunReader(recorded.floor).taskRunContexts({
      repo: "re-cinq/lore",
      line: "implementation-loop",
      taskIds: ["task-11"],
    });

    const paths = recorded.requests.map((request) => request.path);

    expect({
      runs: [...found].map(([taskId, context]) => [taskId, context.run.id]),
      listedCount: paths.filter((path) => path.startsWith("/assembly-runs?"))
        .length,
      byId: paths.filter((path) => /^\/assembly-runs\/[^?]/.test(path)),
    }).toEqual({
      runs: [["task-11", "run-task-11"]],
      listedCount: 11,
      byId: [],
    });
  });
});
