// Acceptance: the REAL feature-planning blueprint walked end to end through the
// real start/node/resume handlers — the cluster replaced by scripted CR statuses,
// the author by resume events. Complements planning-author-loop.test.ts, which
// replays the graph pure: this suite covers the choreography around it (event
// handlers, artifact delivery, the resume args channel, service-node publish),
// where the lifecycle defects (#1162–#1186) and the args-merge defect (#1462)
// actually lived.

import { describe, it, expect } from "vitest";
import {
  createLineHarness,
  fileArtifactEnvelope,
  resultEnvelope,
} from "./line-acceptance-harness.js";

const short = (id: string) => id.substring(0, 12);

async function parkedOnAuthor(h: ReturnType<typeof createLineHarness>) {
  const id = await h.start("feature-planning", {
    args: { repo: "re-cinq/lore", feature_id: "feat-1" },
  });

  await h.completeAgentNode(id, "analyze", { outcome: "success" });

  return id;
}

async function acceptedThroughSpecPlan(
  h: ReturnType<typeof createLineHarness>,
) {
  const id = await parkedOnAuthor(h);

  await h.resume(id, "author", "success");
  await h.completeAgentNode(id, "analyse-specs", {
    output: [
      fileArtifactEnvelope({
        taskId: id,
        agentName: `${short(id)}-analyse-specs`,
        event: "spec.plan",
        path: "spec-plan.json",
        content: '{"changes":[{"spec":"specs/x/spec.md","action":"amend"}]}',
      }),
      resultEnvelope('LORE_NODE_RESULT: {"outcome":"success"}'),
    ].join("\n"),
  });

  return id;
}

describe("feature-planning acceptance: the analyze round and the author station", () => {
  it("launches the analyze CR on start and parks on the author when it succeeds", async () => {
    const h = createLineHarness();
    const id = await parkedOnAuthor(h);

    expect(h.launched.map((s) => s.name)).toEqual([`${short(id)}-analyze`]);
    expect(h.visits()).toEqual([
      ["analyze", "success"],
      ["author", null],
    ]);
  });

  it("runs analyze round 2 when the author asks for changes, with the feedback merged into args", async () => {
    const h = createLineHarness();
    const id = await parkedOnAuthor(h);

    await h.resume(id, "author", "changes_requested", {
      round_feedback: "tighten the scope to the mcp adapter",
    });

    expect(h.launched.map((s) => s.name)).toEqual([
      `${short(id)}-analyze`,
      `${short(id)}-analyze-2`,
    ]);
    expect((await h.runs.getById(id))?.args).toMatchObject({
      round_feedback: "tighten the scope to the mcp adapter",
    });
  });

  it("moves to analyse-specs when the author accepts the plan", async () => {
    const h = createLineHarness();
    const id = await parkedOnAuthor(h);

    await h.resume(id, "author", "success");

    expect(h.launched.at(-1)?.name).toBe(`${short(id)}-analyse-specs`);
  });

  it("fails the run with the author named when the author abandons the feature", async () => {
    const h = createLineHarness();
    const id = await parkedOnAuthor(h);

    await h.resume(id, "author", "failed");

    expect(await h.runs.getById(id)).toMatchObject({
      status: "finished",
      outcome: "failed",
      reason: 'node "author" failed',
    });
    expect(h.launched).toHaveLength(1);
  });
});

describe("feature-planning acceptance: artifacts feed the next station", () => {
  it("merges the spec.plan artifact into args.spec_plan before the write node launches", async () => {
    const h = createLineHarness();
    const id = await acceptedThroughSpecPlan(h);

    expect((await h.runs.getById(id))?.args.spec_plan).toBe(
      '{"changes":[{"spec":"specs/x/spec.md","action":"amend"}]}',
    );
    expect(h.launched.at(-1)?.name).toBe(`${short(id)}-write`);
  });

  it("re-runs analyse-specs once when write rejects the change set", async () => {
    const h = createLineHarness();
    const id = await acceptedThroughSpecPlan(h);

    await h.completeAgentNode(id, "write", { outcome: "changes_requested" });

    expect(h.launched.at(-1)?.name).toBe(`${short(id)}-analyse-specs-2`);
  });
});

describe("feature-planning acceptance: the spec PR and decomposition", () => {
  it("parks on the merged station after push and resumes into decompose when the PR merges", async () => {
    const h = createLineHarness();
    const id = await acceptedThroughSpecPlan(h);

    await h.completeAgentNode(id, "write", { outcome: "success" });
    await h.completeAgentNode(id, "push", { outcome: "success" });

    expect(h.visits().at(-1)).toEqual(["merged", null]);
    expect(h.launched.at(-1)?.name).toBe(`${short(id)}-push`);

    await h.resume(id, "merged", "success");

    expect(h.launched.at(-1)?.name).toBe(`${short(id)}-decompose`);
  });

  it("returns a spec PR review objection to the author, not to an agent", async () => {
    const h = createLineHarness();
    const id = await acceptedThroughSpecPlan(h);

    await h.completeAgentNode(id, "write", { outcome: "success" });
    await h.completeAgentNode(id, "push", { outcome: "success" });
    await h.resume(id, "merged", "changes_requested");

    expect(h.visits().at(-1)).toEqual(["author", null]);
    expect(h.launched.at(-1)?.name).toBe(`${short(id)}-push`);
  });

  it("publishes the issues node to the pooled service and completes the run on its report", async () => {
    const h = createLineHarness();
    const id = await acceptedThroughSpecPlan(h);

    await h.completeAgentNode(id, "write", { outcome: "success" });
    await h.completeAgentNode(id, "push", { outcome: "success" });
    await h.resume(id, "merged", "success");
    await h.completeAgentNode(id, "decompose", { outcome: "success" });

    expect(h.published).toEqual([
      expect.objectContaining({
        eventName: "station.run",
        params: expect.objectContaining({
          assemblyLineId: id,
          nodeId: "issues",
          nodeType: "issues",
        }),
      }),
    ]);

    await h.resume(id, "issues", "success");

    expect(await h.runs.getById(id)).toMatchObject({
      status: "finished",
      outcome: "completed",
    });
  });
});
