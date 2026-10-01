import { describe, expect, it } from "vitest";
import type { Report, Tools } from "@re-cinq/floor-station";
import type { LoopRunClosedDeps } from "@re-cinq/lore-shared/backlog/loop-run-closed.js";
import {
  planRun,
  planVisit,
  recordedPlanFloor,
} from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import {
  closedLoopRunOf,
  floorInfraFailures,
  settlingLoopTickets,
  type FloorLoopRun,
} from "./loop-closed.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const NEXT: Report = { outcome: "success" };
const SUCCESS = { outcome: "success" };
const PR_URL = "https://github.com/acme/widgets/pull/12";
const OPENED = planVisit("open-pr", {
  outcome: "success",
  produced: { pr_url: PR_URL },
});
const UNCLAIMED = planVisit("dod", {
  outcome: "failed",
  error: "unclaimed: no worker offers agent",
});

function loopRun(overrides: Parameters<typeof planRun>[0] = {}) {
  return planRun({
    id: "run-1",
    lineId: "implementation-loop",
    repo: "github.com/acme/widgets",
    subjectKey: "backlog:tickets",
    startItems: {
      repo: {
        kind: "git",
        ref: "github.com/acme/widgets@lore/implementation-loop/issue-7",
        by: "lore",
      },
      task_id: { kind: "value", ref: "task-1", by: "lore" },
    },
    outcome: "success",
    finishedAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  });
}

describe("closedLoopRunOf", () => {
  it("reads run-1 as the loop run of acme/widgets for task-1 on its ticket branch, with the pull request open-pr produced", () => {
    const { run } = closedLoopRunOf(loopRun(), [OPENED]);

    expect(run).toMatchObject({
      id: "run-1",
      repo: "acme/widgets",
      blueprintName: "implementation-loop",
      taskId: "task-1",
      branch: "lore/implementation-loop/issue-7",
      args: { pr_url: PR_URL, pr_number: 12 },
    });
  });

  it("reads a run keyed on backlog tickets as a backlog ticket's", () => {
    const { run } = closedLoopRunOf(
      loopRun({
        startItems: {
          ...loopRun().startItems,
          backlog: { kind: "value", ref: "tickets", by: "lore" },
        },
      }),
      [OPENED],
    );

    expect(run.source).toBe("backlog");
  });

  it("reads a run keyed on spec-task-5e7c01d7 as a plan's task", () => {
    const { run } = closedLoopRunOf(
      loopRun({
        startItems: {
          ...loopRun().startItems,
          backlog: { kind: "value", ref: "spec-task-5e7c01d7", by: "lore" },
        },
      }),
      [OPENED],
    );

    expect(run.source).toBe("plan");
  });

  it("reads a run settled as success as completed, ending on a done visit after its last real one", () => {
    const settled = closedLoopRunOf(loopRun(), [
      OPENED,
      planVisit("await-pr", SUCCESS),
    ]);

    expect(settled.outcome).toBe("completed");
    expect(settled.visits.map((visit) => visit.nodeId)).toEqual([
      "open-pr",
      "await-pr",
      "done",
    ]);
  });

  it("keeps iteration_max as the outcome of a run that spent a retry budget, with no done visit", () => {
    const settled = closedLoopRunOf(loopRun({ outcome: "iteration_max" }), [
      UNCLAIMED,
    ]);

    expect(settled.outcome).toBe("iteration_max");
    expect(settled.visits.map((visit) => visit.nodeId)).toEqual(["dod"]);
  });

  it("writes a dod_resolved value as the already-resolved failure detail", () => {
    const { visits } = closedLoopRunOf(loopRun(), [
      planVisit("dod", {
        outcome: "changes_requested",
        produced: { dod_resolved: "merged in #2064" },
      }),
    ]);

    expect(visits[0].failureDetail).toBe("already resolved: merged in #2064");
  });

  it("takes a visit's own blocked line as its failure detail, and its error when it reported none", () => {
    const { visits } = closedLoopRunOf(loopRun({ outcome: "failed" }), [
      planVisit("dod", {
        outcome: "changes_requested",
        produced: { dod_blocked: "no observable claim" },
      }),
      planVisit("tdd-round", { outcome: "failed", error: "exit code 1" }),
    ]);

    expect(visits.map((visit) => visit.failureDetail)).toEqual([
      "no observable claim",
      "exit code 1",
    ]);
  });

  it("classes the floor's unclaimed error as unclaimed and an OOMKilled pod as infra", () => {
    const { visits } = closedLoopRunOf(loopRun({ outcome: "failed" }), [
      UNCLAIMED,
      planVisit("tdd-round", { outcome: "failed", error: "pod OOMKilled" }),
    ]);

    expect(visits.map((visit) => visit.failureClass)).toEqual([
      "unclaimed",
      "infra",
    ]);
  });
});

describe("floorInfraFailures", () => {
  const SINCE = new Date("2026-10-01T00:00:00.000Z");
  const ASKED = {
    repo: "acme/widgets",
    branch: "lore/implementation-loop/issue-7",
    since: SINCE,
    excludeRunId: "run-now",
  };

  function floorHolding(runs: ReturnType<typeof loopRun>[]) {
    return recordedPlanFloor({
      runs,
      visits: Object.fromEntries(runs.map((run) => [run.id, [UNCLAIMED]])),
    }).floor;
  }

  it("counts one earlier run on the branch that ended unclaimed", async () => {
    const floor = floorHolding([
      loopRun({ id: "run-before", outcome: "iteration_max" }),
    ]);

    expect(await floorInfraFailures(floor, ASKED)).toBe(1);
  });

  it("leaves out the run that just closed, a run on another ticket's branch and a run from before the window", async () => {
    const floor = floorHolding([
      loopRun({ id: "run-now", outcome: "iteration_max" }),
      loopRun({
        id: "run-other",
        outcome: "iteration_max",
        startItems: {
          repo: {
            kind: "git",
            ref: "github.com/acme/widgets@lore/implementation-loop/issue-9",
            by: "lore",
          },
        },
      }),
      loopRun({
        id: "run-old",
        outcome: "iteration_max",
        createdAt: "2026-09-29T09:00:00.000Z",
      }),
    ]);

    expect(await floorInfraFailures(floor, ASKED)).toBe(0);
  });
});

describe("settlingLoopTickets", () => {
  function scene(run: ReturnType<typeof loopRun> | null, visits = [OPENED]) {
    const steps: string[] = [];
    const closed = (settled: FloorLoopRun): LoopRunClosedDeps => ({
      getTaskIssueNumber: () => Promise.resolve(7),
      listStationRuns: () => Promise.resolve(settled.visits),
      addLabel: (_repo, issue, label) => {
        steps.push(`label #${issue} ${label}`);

        return Promise.resolve();
      },
      comment: (_repo, issue) => {
        steps.push(`comment #${issue}`);

        return Promise.resolve();
      },
      closeIssue: (_repo, issue) => {
        steps.push(`close #${issue}`);

        return Promise.resolve();
      },
      closePr: (_repo, pr) => {
        steps.push(`close pr ${pr}`);

        return Promise.resolve();
      },
      emitTick: (repo) => {
        steps.push(`tick ${repo}`);

        return Promise.resolve();
      },
      priorInfraFailures: () => Promise.resolve(0),
      maxInfraDeferrals: 3,
    });
    const handle = settlingLoopTickets(
      {
        run: () => Promise.resolve(run),
        visits: () => Promise.resolve(visits),
        closed,
      },
      () => Promise.resolve(NEXT),
    );
    const settle = (lineId = "implementation-loop") =>
      handle(
        {
          visitId: "visit-1",
          iteration: 1,
          needs: { run_id: "run-1", line_id: lineId, outcome: "success" },
        },
        TOOLS,
      );

    return { settle, steps };
  }

  it("only re-arms the tick for acme/widgets when the run ended green on await-pr", async () => {
    const { settle, steps } = scene(loopRun(), [
      OPENED,
      planVisit("await-pr", SUCCESS),
    ]);

    await settle();

    expect(steps).toEqual(["tick acme/widgets"]);
  });

  it("labels issue 7 blocked and comments when await-pr ended on unresolved threads", async () => {
    const { settle, steps } = scene(loopRun(), [
      OPENED,
      planVisit("await-pr", { outcome: "failed" }),
    ]);

    await settle();

    expect(steps).toEqual([
      "label #7 lore:blocked",
      "comment #7",
      "tick acme/widgets",
    ]);
  });

  it("closes issue 7 with a comment when the definition of done found it already resolved", async () => {
    const { settle, steps } = scene(loopRun(), [
      planVisit("dod", {
        outcome: "changes_requested",
        produced: { dod_resolved: "merged in #2064" },
      }),
    ]);

    await settle();

    expect(steps).toEqual(["comment #7", "close #7", "tick acme/widgets"]);
  });

  it("defers issue 7 with a comment and no label when no worker claimed the run", async () => {
    const { settle, steps } = scene(loopRun({ outcome: "iteration_max" }), [
      UNCLAIMED,
    ]);

    await settle();

    expect(steps).toEqual(["comment #7", "tick acme/widgets"]);
  });

  it("settles no ticket for a run of another line", async () => {
    const { settle, steps } = scene(loopRun());

    expect(await settle("code-review")).toEqual(NEXT);
    expect(steps).toEqual([]);
  });

  it("settles no ticket when the floor no longer has the run", async () => {
    const { settle, steps } = scene(null);

    await settle();

    expect(steps).toEqual([]);
  });
});
