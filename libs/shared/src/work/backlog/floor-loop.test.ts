import { describe, expect, it } from "vitest";
import {
  PLAN_BLOB_HASH,
  planRun,
  recordedPlanFloor,
} from "../../outbound/floor/recorded-plan-floor.js";
import {
  openFloorTicketRuns,
  openRunOfTicket,
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
  openPr: null,
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

  it("starts the run on the branch keyed on backlog ticket-7, with the task, the ticket as a file and the issue's title and number", async () => {
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
        backlog: { kind: "value", ref: "ticket-7", by: "lore" },
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

  it("starts the run with pull request 9's url as pr_url when the branch is resumed with one open", async () => {
    const { deps, started } = scene();

    await startTicketOnFloor(deps, {
      ...TICKET,
      openPr: { number: 9, url: "https://github.com/acme/widgets/pull/9" },
    });

    expect(started()[0].body).toMatchObject({
      startItems: {
        pr_url: {
          kind: "value",
          ref: "https://github.com/acme/widgets/pull/9",
          by: "lore",
        },
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

function loopRun(id: string, backlog: string) {
  return planRun({
    id,
    lineId: "implementation-loop",
    startItems: { backlog: { kind: "value", ref: backlog, by: "lore" } },
  });
}

describe("openFloorTicketRuns", () => {
  it("asks the floor for the open implementation-loop runs of github.com/acme/widgets, whatever their subject", async () => {
    const { floor, requests } = recordedPlanFloor();

    await openFloorTicketRuns(floor, "Acme/Widgets");

    expect(requests.map((request) => request.path)).toEqual([
      "/assembly-runs?repo=github.com%2Facme%2Fwidgets&line=implementation-loop&open=true",
    ]);
  });

  it("answers the runs keyed backlog:ticket-7 and backlog:ticket-9", async () => {
    const { floor } = recordedPlanFloor({
      runs: [loopRun("run-7", "ticket-7"), loopRun("run-9", "ticket-9")],
    });

    const open = await openFloorTicketRuns(floor, "acme/widgets");

    expect(open.map(({ id }) => id)).toEqual(["run-7", "run-9"]);
  });

  it("counts a run keyed backlog:tickets, started before tickets had a key of their own, as an open ticket run", async () => {
    const { floor } = recordedPlanFloor({
      runs: [loopRun("run-old", "tickets")],
    });

    const open = await openFloorTicketRuns(floor, "acme/widgets");

    expect(open.map(({ id }) => id)).toEqual(["run-old"]);
  });

  it("leaves out an upkeep run keyed backlog:upkeep-12 and a plan task run keyed backlog:spec-task-t1", async () => {
    const { floor } = recordedPlanFloor({
      runs: [
        loopRun("run-upkeep", "upkeep-12"),
        loopRun("run-plan", "spec-task-t1"),
        loopRun("run-7", "ticket-7"),
      ],
    });

    const open = await openFloorTicketRuns(floor, "acme/widgets");

    expect(open.map(({ id }) => id)).toEqual(["run-7"]);
  });

  it("answers nothing when the repository has no loop run open", async () => {
    const { floor } = recordedPlanFloor();

    expect(await openFloorTicketRuns(floor, "acme/widgets")).toEqual([]);
  });
});

describe("openRunOfTicket", () => {
  const forIssue = (id: string, backlog: string, issueNumber: number) => {
    const run = loopRun(id, backlog);

    return {
      ...run,
      startItems: {
        ...run.startItems,
        issue_number: {
          kind: "value" as const,
          ref: `${issueNumber}`,
          by: "lore",
        },
      },
    };
  };

  it("answers the id of run-9, whose issue_number is 9, among the open runs of tickets 7 and 9", async () => {
    const { floor } = recordedPlanFloor({
      runs: [
        forIssue("run-7", "ticket-7", 7),
        forIssue("run-9", "ticket-9", 9),
      ],
    });

    expect(await openRunOfTicket(floor, "acme/widgets", 9)).toEqual({
      id: "run-9",
    });
  });

  it("answers null when no open ticket run is for issue 11", async () => {
    const { floor } = recordedPlanFloor({
      runs: [forIssue("run-9", "ticket-9", 9)],
    });

    expect(await openRunOfTicket(floor, "acme/widgets", 11)).toBeNull();
  });
});
