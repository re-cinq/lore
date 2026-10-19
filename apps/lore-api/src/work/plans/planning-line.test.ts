import { describe, it, expect } from "vitest";
import type { PlanLine } from "@re-cinq/lore-shared/project/plans/plan-run.js";
import {
  approvalDecisionOf,
  reopenActionOf,
  reopenWhenAuthorWaits,
} from "./planning-line.js";

const PARK = { runId: "run-1", nodeId: "author", iteration: 1 };

const lineOn = (
  open: string | null,
  over: Partial<PlanLine> = {},
): PlanLine => ({
  lineId: "run-1",
  status: open === null ? "finished" : "running",
  outcome: null,
  prNumber: null,
  prUrl: null,
  branch: null,
  open,
  parkedAuthor: null,
  parkedMerged: null,
  merged: false,
  ...over,
});

describe("approvalDecisionOf", () => {
  it("hands the plan over when its line waits on the author", () => {
    expect(
      approvalDecisionOf(lineOn("author", { parkedAuthor: PARK as never })),
    ).toEqual({ kind: "hand-over" });
  });

  it("starts the spec work for a plan with no line and for one whose line ended", () => {
    expect([null, lineOn(null)].map(approvalDecisionOf)).toEqual([
      { kind: "start-spec-work" },
      { kind: "start-spec-work" },
    ]);
  });

  it("refuses with 'still refining' on analyze and with 'specs are being written' on write", () => {
    expect(
      [lineOn("analyze"), lineOn("write")].map(approvalDecisionOf),
    ).toEqual([
      {
        kind: "refused",
        reason: "the planning agent is still refining a section",
      },
      { kind: "refused", reason: "the specs are being written" },
    ]);
  });

  it("refuses with 'still refining' while plan-findings writes the validator's findings, which come before any spec work", () => {
    expect(approvalDecisionOf(lineOn("plan-findings"))).toEqual({
      kind: "refused",
      reason: "the planning agent is still refining a section",
    });
  });
});

describe("reopenActionOf", () => {
  it("reports to the spec-PR park of a line waiting on its merge", () => {
    expect(
      reopenActionOf(lineOn("await-merge", { parkedMerged: PARK as never })),
    ).toEqual({ kind: "report", parked: PARK });
  });

  it("does nothing for no line, an ended line and a line waiting on the author", () => {
    expect(
      [
        null,
        lineOn(null),
        lineOn("author", { parkedAuthor: PARK as never }),
      ].map(reopenActionOf),
    ).toEqual([{ kind: "nothing" }, { kind: "nothing" }, { kind: "nothing" }]);
  });

  it("cancels run-1 while the spec work is on write, and while the spec-tasks are being filed", () => {
    expect([lineOn("write"), lineOn("issues")].map(reopenActionOf)).toEqual([
      { kind: "cancel", runId: "run-1" },
      { kind: "cancel", runId: "run-1" },
    ]);
  });
});

describe("reopenWhenAuthorWaits", () => {
  it("reopens approved plan p1 when its line waits on the author", async () => {
    const reopened: string[] = [];

    const answer = await reopenWhenAuthorWaits(
      { parkedAuthor: PARK as never },
      { id: "p1", status: "approved" },
      async (planId) => void reopened.push(planId),
    );

    expect({ answer, reopened }).toEqual({ answer: true, reopened: ["p1"] });
  });

  it("reopens nothing for a draft plan, nor for an approved one with no line", async () => {
    const reopened: string[] = [];
    const reopen = async (planId: string) => void reopened.push(planId);

    const answers = [
      await reopenWhenAuthorWaits(
        { parkedAuthor: PARK as never },
        { id: "p1", status: "draft" },
        reopen,
      ),
      await reopenWhenAuthorWaits(
        null,
        { id: "p1", status: "approved" },
        reopen,
      ),
    ];

    expect({ answers, reopened }).toEqual({
      answers: [false, false],
      reopened: [],
    });
  });
});
