import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { PlanFinding } from "../../domain/plan-writer.js";
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

function recordingPlans(existing: PlanFinding[]) {
  const calls: Array<{ planId: string; edits: unknown }> = [];

  return {
    calls,
    plans: {
      addQuestions: async (planId: string, edits: unknown) => {
        calls.push({ planId, edits });
      },
      findingsOf: async () => existing,
    },
  };
}

describe("deliverPlanValidation", () => {
  it("removes an old unresolved finding a pass no longer reports, keeps the resolved one and the re-reported one", async () => {
    const { port } = await openRun();
    const { calls, plans } = recordingPlans([
      { slot: "intent", findingId: "f-old-unresolved", resolved: false },
      { slot: "intent", findingId: "f-old-resolved", resolved: true },
      { slot: "scope", findingId: "f-kept", resolved: false },
    ]);
    const answer = {
      findings: [
        { slot: "scope", finding_id: "f-kept", text: "Still open.", why: "Not addressed.", severity: "blocker" },
        { slot: "intent", text: "No success metric stated.", why: "Cannot judge Definition of Done without one.", severity: "blocker" },
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
              slot: "scope",
              findingId: "f-kept",
              text: "Still open.",
              why: "Not addressed.",
              severity: "blocker",
            },
            {
              op: "add-finding",
              slot: "intent",
              findingId: expect.stringMatching(/^f-/),
              text: "No success metric stated.",
              why: "Cannot judge Definition of Done without one.",
              severity: "blocker",
            },
            { op: "remove-block", slot: "intent", blockId: "f-old-unresolved" },
          ],
        },
      },
    ]);
  });

  it("adds one blocker finding to plan b4b2026f without an echoed finding_id", async () => {
    const { port } = await openRun();
    const { calls, plans } = recordingPlans([]);
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

  it("removes the one unresolved finding and keeps the resolved one on a clean pass", async () => {
    const { port } = await openRun();
    const { calls, plans } = recordingPlans([
      { slot: "intent", findingId: "f-open", resolved: false },
      { slot: "scope", findingId: "f-done", resolved: true },
    ]);

    await deliverPlanValidation(fileEvent(JSON.stringify({ findings: [] })), {
      assemblyRuns: port,
      plans,
    });

    expect(calls).toEqual([
      {
        planId: PLAN_ID,
        edits: {
          actor: "plan-validator",
          ops: [{ op: "remove-block", slot: "intent", blockId: "f-open" }],
        },
      },
    ]);
  });
});
