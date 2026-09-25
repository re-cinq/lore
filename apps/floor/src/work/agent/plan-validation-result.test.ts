import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { AgentFileEvent } from "./agent-events.js";
import { deliverPlanValidation } from "./plan-validation-result.js";

const TASK = "t1";
const PLAN_ID = "b4b2026f-0000-4000-8000-000000000001";

function fileEvent(content: string | null, over: Partial<AgentFileEvent> = {}) {
  return {
    taskId: TASK,
    agentCrName: "abc-validate",
    event: "plan.validation.result",
    path: "plan-validation-result.json",
    content,
    reason: null,
    uploaded: false,
    ...over,
  } satisfies AgentFileEvent;
}

async function openRun(args: Record<string, unknown> = {}) {
  const port = new InMemoryAssemblyRuns();
  const id = await port.start({
    blueprintName: "feature-planning",
    repo: "re-cinq/lore",
    branch: "plan/p1",
    taskId: TASK,
    args: { plan_id: PLAN_ID, ...args },
  });

  await port.markRunning(id);

  return { port, id };
}

function recordingPlans() {
  const calls: Array<{ planId: string; edits: unknown }> = [];

  return {
    calls,
    plans: {
      addQuestions: async (planId: string, edits: unknown) => {
        calls.push({ planId, edits });
      },
    },
  };
}

describe("deliverPlanValidation", () => {
  it("adds one blocker finding to plan b4b2026f without an echoed finding_id", async () => {
    const { port } = await openRun();
    const { calls, plans } = recordingPlans();
    const answer = {
      findings: [
        {
          slot: "intent",
          text: "No success metric stated.",
          why: "Cannot judge Definition of Done without one.",
          severity: "blocker",
        },
      ],
    };

    await deliverPlanValidation(fileEvent(JSON.stringify(answer)), {
      assemblyRuns: port,
      plans,
    });

    expect(calls).toEqual([
      {
        planId: PLAN_ID,
        edits: {
          actor: "plan-validator",
          ops: [
            {
              op: "add-finding",
              slot: "intent",
              findingId: expect.stringMatching(/^f-[0-9a-f]+$/),
              text: "No success metric stated.",
              why: "Cannot judge Definition of Done without one.",
              severity: "blocker",
            },
          ],
        },
      },
    ]);
  });
});
