import { describe, it, expect } from "vitest";
import { startEscalationLine } from "./start-escalation-line.js";
import type { StartEscalationDeps } from "./start-escalation-line.js";

const TASK = { id: "t-1", repo: "o/r", branch: "lore/t-1" };
const CAUSE = { reason: "supervisor_panic", diagnostic: "pod died" };

function deps(over: Partial<StartEscalationDeps> = {}): StartEscalationDeps {
  return {
    findOpenBySubject: async () => null,
    countBySubject: async () => 0,
    start: async () => "run-1",
    ...over,
  };
}

describe("startEscalationLine", () => {
  it("starts the escalation line carrying what the Issue must say", async () => {
    const started: Array<Record<string, unknown>> = [];

    await startEscalationLine(
      TASK,
      CAUSE,
      deps({
        start: async (input) => {
          started.push(input as never);

          return "run-1";
        },
      }),
    );

    expect(started[0]).toMatchObject({
      blueprintName: "escalation",
      taskId: "t-1",
      subjectKey: "escalate:t-1",
      args: {
        branch_name: "lore/t-1",
        reason: "supervisor_panic",
        diagnostic: "pod died",
      },
    });
  });

  it("starts nothing when a line for this task is already open, so two noticers file one issue", async () => {
    expect(
      await startEscalationLine(
        TASK,
        CAUSE,
        deps({ findOpenBySubject: async () => ({ id: "already" }) }),
      ),
    ).toBeNull();
  });

  it("stops after 3 finished lines, so a task stuck failed is not reported forever", async () => {
    expect(
      await startEscalationLine(
        TASK,
        CAUSE,
        deps({ countBySubject: async () => 3 }),
      ),
    ).toBeNull();
  });
});
