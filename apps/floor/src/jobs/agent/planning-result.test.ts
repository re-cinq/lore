import { describe, it, expect } from "vitest";
import { InMemoryTaskStore } from "@re-cinq/lore-shared/project/tasks/task-store-memory.js";
import { InMemoryFeatures } from "@re-cinq/lore-shared/project/features/features-memory.js";
import { Features } from "@re-cinq/lore-shared/project/features/features.js";
import type { AgentFileEvent } from "./agent-events.js";
import {
  deliverPlanningResult,
  deliverPlanningResults,
  PLANNING_RESULT_EVENT,
} from "./planning-result.js";

const REPO = "re-cinq/lore";
const gap = {
  sections: [
    { title: "Overview", body: "A live view over the AssemblyLines." },
  ],
  draft_spec_markdown: "# Assembly lines live view",
};

function fileEvent(over: Partial<AgentFileEvent> = {}): AgentFileEvent {
  return {
    taskId: "t1",
    agentCrName: "abc-analyze",
    event: PLANNING_RESULT_EVENT,
    path: "/workspace/target/result.json",
    content: JSON.stringify(gap),
    reason: null,
    ...over,
  };
}

async function harness() {
  const features = new Features(REPO, new InMemoryFeatures());
  const feature = await features.create({
    title: "Assembly lines live view",
    prompt: "a live view",
  });

  await features.appendIteration(feature.id, null);
  const tasks = new InMemoryTaskStore([
    {
      id: "t1",
      task_type: "feature-planning",
      status: "running",
      target_repo: REPO,
      description: "plan it",
      context_bundle: { feature_id: feature.id, iteration: 1 },
    },
  ]);

  return {
    features,
    id: feature.id,
    deps: { tasks, featuresFor: async () => ({ features }) },
  };
}

describe("deliverPlanningResult", () => {
  it("stores the artifact as the round's result", async () => {
    const { features, id, deps } = await harness();

    expect(await deliverPlanningResult(fileEvent(), deps)).toEqual({
      outcome: "ready",
    });
    expect((await features.get(id))?.iterations[0]).toMatchObject({
      status: "ready",
    });
  });

  it("leaves the round running when an attempt produced no file, so a retry can rescue it", async () => {
    const { features, id, deps } = await harness();
    const result = await deliverPlanningResult(
      fileEvent({ content: null, reason: "missing" }),
      deps,
    );

    expect(result).toEqual({
      outcome: "failed",
      error: "the agent produced no result.json (missing)",
    });
    // A failed ATTEMPT is not a failed ROUND: the node has an iteration_max
    // back-edge, and the retry routinely succeeds. Recording failure here showed the
    // author "round failed" with a Retry button while a retry was already running.
    expect((await features.get(id))?.iterations[0]).toMatchObject({
      status: "running",
    });
  });

  it("leaves the round running when an attempt posted invalid JSON", async () => {
    const { features, id, deps } = await harness();
    const result = await deliverPlanningResult(
      fileEvent({ content: "{not json" }),
      deps,
    );

    expect(result.outcome).toBe("failed");
    // Same rule: the line's terminal settlement is the single owner of "this round
    // failed", so it cannot disagree with itself.
    expect((await features.get(id))?.iterations[0]).toMatchObject({
      status: "running",
    });
  });

  it("ignores an artifact raised under another name", async () => {
    const { deps } = await harness();

    expect(
      await deliverPlanningResult(
        fileEvent({ event: "coverage.report" }),
        deps,
      ),
    ).toMatchObject({ outcome: "skipped" });
  });

  it("ignores an artifact from a task that is not a planning round", async () => {
    const { features } = await harness();
    const tasks = new InMemoryTaskStore([
      {
        id: "t1",
        task_type: "implementation",
        status: "running",
        target_repo: REPO,
        description: "build it",
      },
    ]);

    expect(
      await deliverPlanningResult(fileEvent(), {
        tasks,
        featuresFor: async () => ({ features }),
      }),
    ).toMatchObject({ outcome: "skipped" });
  });

  it("ignores an artifact whose task no longer exists", async () => {
    const { features } = await harness();

    expect(
      await deliverPlanningResult(fileEvent({ taskId: "gone" }), {
        tasks: new InMemoryTaskStore([]),
        featuresFor: async () => ({ features }),
      }),
    ).toMatchObject({ outcome: "skipped" });
  });
});

describe("deliverPlanningResults", () => {
  it("counts the rounds it settled and leaves the rest alone", async () => {
    const { deps } = await harness();
    const delivered = await deliverPlanningResults(
      [fileEvent(), fileEvent({ event: "other.artifact" })],
      deps,
    );

    expect(delivered).toBe(1);
  });

  it("survives a delivery that throws, so the telemetry batch still lands", async () => {
    const { features } = await harness();
    const deps = {
      tasks: {
        getById: async () => {
          throw new Error("db down");
        },
      },
      featuresFor: async () => ({ features }),
    };

    await expect(deliverPlanningResults([fileEvent()], deps)).resolves.toBe(0);
  });
});
