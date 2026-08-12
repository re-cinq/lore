import { describe, it, expect } from "vitest";
import {
  fetchFeatureRun,
  toFeatureRunPayload,
  specPhaseOf,
} from "./feature-run";
import type {
  AssemblyLineRun,
  AssemblyLineRunNode,
} from "./assembly-line-runs";

const planningRun: AssemblyLineRun = {
  id: "ae7918b1-4baa-41fc-8b34-deb1be4cddf9",
  definitionName: "feature-planning",
  taskId: "e25bc81a-469a-42a8-ab08-ed824b2160d8",
  repo: "re-cinq/lore",
  branch: "lore/feature-planning/assembly-lines-live-view",
  status: "running",
  outcome: null,
  reason: null,
  createdAt: "2026-08-10T13:13:31.702Z",
  startedAt: "2026-08-10T13:13:35.000Z",
  durationSeconds: null,
  prUrl: null,
  prNumber: null,
  createdBy: "gedaiu",
  costUsd: null,
};

const analyzeNode: AssemblyLineRunNode = {
  nodeId: "analyze",
  iteration: 1,
  outcome: null,
  agentCrName: "ae7918b1-4ba-analyze",
  commitSha: null,
  durationSeconds: null,
  startedAt: "2026-08-10T13:13:40.873Z",
};

describe("toFeatureRunPayload", () => {
  it("resolves the declared feature-planning graph for a run with no visit rows", () => {
    expect(toFeatureRunPayload(planningRun, [])).toMatchObject({
      id: planningRun.id,
      status: "running",
      startedAt: "2026-08-10T13:13:35.000Z",
      repo: "re-cinq/lore",
      reason: null,
      synthetic: false,
      nodes: [],
      definition: {
        name: "feature-planning",
        entry: "analyze",
        exit: "done",
        edges: [{ from: "analyze", to: "done", on: "always" }],
      },
    });
  });

  it("keeps the visit rows so the panel can colour the nodes", () => {
    expect(toFeatureRunPayload(planningRun, [analyzeNode]).nodes).toEqual([
      analyzeNode,
    ]);
  });

  it("marks a run of an unknown definition synthetic", () => {
    const custom = { ...planningRun, definitionName: "bespoke-line" };

    expect(toFeatureRunPayload(custom, [analyzeNode])).toMatchObject({
      synthetic: true,
      definition: { name: "bespoke-line", entry: "analyze" },
    });
  });

  it("skips the lookup entirely for a round with no task yet", async () => {
    expect(await fetchFeatureRun(null)).toBeNull();
    expect(await fetchFeatureRun(undefined)).toBeNull();
    expect(await fetchFeatureRun("")).toBeNull();
  });

  it("carries the failure reason of a finished line", () => {
    const failed = {
      ...planningRun,
      status: "finished",
      outcome: "failed",
      reason: 'node "analyze" failed',
    };

    expect(toFeatureRunPayload(failed, [analyzeNode])).toMatchObject({
      status: "finished",
      reason: 'node "analyze" failed',
    });
  });
});

describe("specPhaseOf", () => {
  const node = (
    nodeId: string,
    outcome: string | null,
    startedAt = "2026-08-12T19:00:00Z",
  ) => ({ nodeId, iteration: 1, outcome, startedAt }) as never;

  const run = (status: string, nodes: unknown[]) =>
    ({ status, nodes }) as never;

  it("reports the spec phase running, timed from the node that is working", () => {
    // The wizard used to decide this from a local boolean set when the button was
    // pressed, and time it from the last ROUND's creation — so a finished line left
    // "Writing the spec…" on screen forever, ticking past 80 minutes of a 15 minute
    // budget while nothing at all was running.
    expect(
      specPhaseOf(
        run("running", [
          node("author", "success"),
          node("analyse-specs", null, "2026-08-12T19:30:00Z"),
        ]),
      ),
    ).toEqual({ running: true, since: "2026-08-12T19:30:00Z" });
  });

  it("is not running once the line has finished", () => {
    // push succeeded and no PR appeared: the card must come down and give the author
    // their controls back, not imply work is still in flight.
    expect(
      specPhaseOf(run("finished", [node("push", "success")])),
    ).toMatchObject({ running: false });
  });

  it("is not running while a planning round is the open node", () => {
    expect(specPhaseOf(run("running", [node("analyze", null)]))).toMatchObject({
      running: false,
    });
  });

  it("is not running when there is no line at all", () => {
    expect(specPhaseOf(null)).toMatchObject({ running: false });
  });
});
