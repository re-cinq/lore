import { describe, expect, it } from "vitest";
import {
  PLAN_BLOB_HASH,
  planRun,
  recordedPlanFloor,
} from "../../outbound/floor/recorded-plan-floor.js";
import {
  openFloorLoopRun,
  startTicketOnFloor,
  type FloorTicketDeps,
} from "./floor-loop.js";
import type { StartedTicket } from "./implementation-loop-tick.js";

const TICKET: StartedTicket = {
  repo: "Acme/Widgets",
  taskId: "task-1",
  branch: "lore/implementation-loop/issue-7",
  issue: { number: 7, title: "Add the export button" },
  description: "Add the export button\n\nAs a user I want to export.",
};

function scene(overrides: Partial<Omit<FloorTicketDeps, "floor">> = {}) {
  const recorded = recordedPlanFloor();
  const steps: string[] = [];
  const deps: FloorTicketDeps = {
    floor: recorded.floor,
    claim: async (taskId) => {
      steps.push(`claim ${taskId}`);

      return true;
    },
    ensureBranch: (repo, branch) => {
      steps.push(`branch ${repo} ${branch}`);

      return Promise.resolve();
    },
    failTask: (taskId, reason) => {
      steps.push(`failed ${taskId}: ${reason}`);

      return Promise.resolve();
    },
    ...overrides,
  };
  const started = () =>
    recorded.requests.filter(({ path }) => path.endsWith("/start"));

  return { deps, steps, started };
}

describe("startTicketOnFloor", () => {
  it("claims task-1, makes the ticket's branch, then starts the implementation-loop line", async () => {
    const { deps, steps, started } = scene();

    await startTicketOnFloor(deps, TICKET);

    expect(steps).toEqual([
      "claim task-1",
      "branch Acme/Widgets lore/implementation-loop/issue-7",
    ]);
    expect(started().map((request) => request.path)).toEqual([
      "/assembly-lines/implementation-loop/start",
    ]);
  });

  it("starts the run on the branch with the backlog subject, the task, the ticket as a file and the issue's title and number", async () => {
    const { deps, started } = scene();

    await startTicketOnFloor(deps, TICKET);

    expect(started()[0].body).toEqual({
      repo: "github.com/acme/widgets",
      startItems: {
        repo: {
          kind: "git",
          ref: "github.com/acme/widgets@lore/implementation-loop/issue-7",
          by: "lore",
        },
        backlog: { kind: "value", ref: "tickets", by: "lore" },
        task_id: { kind: "value", ref: "task-1", by: "lore" },
        ticket: { kind: "file", ref: PLAN_BLOB_HASH, by: "lore" },
        issue_title: {
          kind: "value",
          ref: "Add the export button",
          by: "lore",
        },
        issue_number: { kind: "value", ref: "7", by: "lore" },
      },
    });
  });

  it("starts nothing when another process claimed task-1 first", async () => {
    const { deps, steps, started } = scene({ claim: async () => false });

    await startTicketOnFloor(deps, TICKET);

    expect(steps).toEqual([]);
    expect(started()).toEqual([]);
  });

  it("fails task-1 with the reason and rethrows when the branch cannot be made", async () => {
    const { deps, steps } = scene({
      ensureBranch: () => Promise.reject(new Error("GitHub 502")),
    });

    await expect(startTicketOnFloor(deps, TICKET)).rejects.toThrow(
      new Error("GitHub 502"),
    );
    expect(steps).toEqual([
      "claim task-1",
      "failed task-1: the ticket could not be started on the floor: GitHub 502",
    ]);
  });
});

describe("openFloorLoopRun", () => {
  it("asks the floor for the open implementation-loop run of github.com/acme/widgets on subject backlog:tickets", async () => {
    const { floor, requests } = recordedPlanFloor();

    await openFloorLoopRun(floor, "Acme/Widgets");

    expect(requests.map((request) => request.path)).toEqual([
      "/assembly-runs?repo=github.com%2Facme%2Fwidgets&line=implementation-loop&subject=backlog%3Atickets&open=true",
    ]);
  });

  it("answers the id of the open run", async () => {
    const { floor } = recordedPlanFloor({
      runs: [planRun({ id: "run-7", lineId: "implementation-loop" })],
    });

    expect(await openFloorLoopRun(floor, "acme/widgets")).toEqual({
      id: "run-7",
    });
  });

  it("answers null when the repository has no loop run open", async () => {
    const { floor } = recordedPlanFloor();

    expect(await openFloorLoopRun(floor, "acme/widgets")).toBeNull();
  });
});
