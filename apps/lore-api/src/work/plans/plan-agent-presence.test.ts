import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readPipelineFile } from "@re-cinq/floor-pipeline";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { RunView, VisitView } from "@re-cinq/floor-client";
import { controllableWatch, until } from "../floor/floor-runs-feed.fixtures.js";
import {
  AGENT_STEPS,
  agentShownOn,
  PlanAgentPresence,
  type PresenceWriter,
} from "./plan-agent-presence.js";

function planningRun(over: Partial<RunView> = {}): RunView {
  return {
    id: "run-1",
    lineId: "feature-planning",
    lineHash: "h1",
    repo: "re-cinq/lore",
    subjectKey: "plan_id:p1",
    startItems: { plan_id: { kind: "value", ref: "p1", by: "lore" } },
    outcome: null,
    reason: null,
    createdAt: "2026-10-08T10:00:00.000Z",
    finishedAt: null,
    ...over,
  } as RunView;
}

function visit(nodeId: string): VisitView {
  return {
    id: `v-${nodeId}`,
    runId: "run-1",
    nodeId,
    iteration: 1,
    report: null,
    branch: null,
  } as VisitView;
}

function reported(nodeId: string): VisitView {
  return { ...visit(nodeId), report: { outcome: "success" } } as VisitView;
}

const PLANNING_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../libs/assembly-lines/src/floor-pipelines/feature-planning.yaml",
);

function agentNodesOfPlanningLine(): string[] {
  const file = readPipelineFile(
    readFileSync(PLANNING_FILE, "utf-8"),
  ) as unknown as {
    line: { nodes: { id: string; station: string }[] };
    stations: Record<string, { kind: string }>;
  };

  return file.line.nodes
    .filter((node) => file.stations[node.station]?.kind === "agent")
    .map((node) => node.id);
}

describe("AGENT_STEPS", () => {
  it("names a step for every agent node of the feature-planning line, and for nothing else", () => {
    expect(Object.keys(AGENT_STEPS).sort()).toEqual(
      agentNodesOfPlanningLine().sort(),
    );
  });
});

describe("agentShownOn", () => {
  it("names the plan step an open analyze visit works on", () => {
    expect(agentShownOn(planningRun(), [visit("analyze")])).toEqual({
      planId: "p1",
      name: "Planning agent (writing the plan)",
    });
  });

  it("names one agent for the parallel section writers of a fan-out", () => {
    expect(
      agentShownOn(planningRun(), [
        reported("split-sections"),
        visit("write"),
        visit("write"),
      ]),
    ).toEqual({ planId: "p1", name: "Planning agent (writing the spec)" });
  });

  it("shows nobody while only a service or a person's step is open", () => {
    expect(
      agentShownOn(planningRun(), [reported("analyze"), visit("author")]),
    ).toEqual({ planId: "p1", name: null });
  });

  it("shows nobody on a finished run, whatever its visits say", () => {
    expect(
      agentShownOn(planningRun({ finishedAt: "2026-10-08T11:00:00.000Z" }), [
        visit("decompose"),
      ]),
    ).toEqual({ planId: "p1", name: null });
  });

  it("answers null for a run of another line", () => {
    expect(
      agentShownOn(planningRun({ lineId: "code-review" }), [visit("analyze")]),
    ).toBeNull();
  });
});

interface Scene {
  runs: Map<string, { run: RunView; visits: VisitView[] }>;
  calls: string[];
}

interface SceneOptions {
  open?: string[];
  failingOpens?: number;
  failingCloses?: number;
}

function sceneOf({
  open = [],
  failingOpens = 0,
  failingCloses = 0,
}: SceneOptions = {}) {
  const floor = controllableWatch();
  const scene: Scene = { runs: new Map(), calls: [] };
  const failuresLeft = { opens: failingOpens, closes: failingCloses };
  const writer: PresenceWriter = {
    openPresence: async ({ planId, user }) => {
      enforceTrue(failuresLeft.opens-- <= 0, Error, "collab down");
      scene.calls.push(`open ${planId} ${user.name}`);
    },
    closePresence: async ({ planId }) => {
      enforceTrue(failuresLeft.closes-- <= 0, Error, "collab down");
      scene.calls.push(`close ${planId}`);
    },
  };
  const presence = new PlanAgentPresence({
    watchFloor: () => floor.watch,
    readRun: async (runId) => scene.runs.get(runId) ?? null,
    openPlanningRuns: async () => open,
    writer,
  });

  presence.start();

  return { floor, scene, presence };
}

describe("PlanAgentPresence", () => {
  it("shows the agent on the plan as soon as its station's visit opens", async () => {
    const { floor, scene, presence } = sceneOf();

    scene.runs.set("run-1", { run: planningRun(), visits: [visit("analyze")] });
    floor.say({ type: "run_changed", runId: "run-1" });
    await until(() => scene.calls.length === 1);
    presence.stop();

    expect(scene.calls).toEqual(["open p1 Planning agent (writing the plan)"]);
  });

  it("takes the agent off the plan when its visit closes", async () => {
    const { floor, scene, presence } = sceneOf();

    scene.runs.set("run-1", { run: planningRun(), visits: [visit("analyze")] });
    floor.say({ type: "run_changed", runId: "run-1" });
    await until(() => scene.calls.length === 1);
    scene.runs.set("run-1", {
      run: planningRun(),
      visits: [reported("analyze"), visit("author")],
    });
    floor.say({ type: "run_changed", runId: "run-1" });
    await until(() => scene.calls.length === 2);
    presence.stop();

    expect(scene.calls[1]).toBe("close p1");
  });

  it("opens once while the same step keeps changing", async () => {
    const { floor, scene, presence } = sceneOf();

    scene.runs.set("run-1", { run: planningRun(), visits: [visit("write")] });
    floor.say({ type: "run_changed", runId: "run-1" });
    floor.say({ type: "run_changed", runId: "run-1" });
    floor.say({ type: "run_started", runId: "run-1" });
    await until(() => scene.calls.length >= 1);
    await presence.settled();
    presence.stop();

    expect(scene.calls).toEqual(["open p1 Planning agent (writing the spec)"]);
  });

  it("renames the agent by leaving and joining again when the run moves to another step", async () => {
    const { floor, scene, presence } = sceneOf();

    scene.runs.set("run-1", { run: planningRun(), visits: [visit("write")] });
    floor.say({ type: "run_changed", runId: "run-1" });
    await until(() => scene.calls.length === 1);
    scene.runs.set("run-1", {
      run: planningRun(),
      visits: [reported("write"), visit("qa-answer")],
    });
    floor.say({ type: "run_changed", runId: "run-1" });
    await until(() => scene.calls.length === 3);
    presence.stop();

    expect(scene.calls.slice(1)).toEqual([
      "close p1",
      "open p1 Planning agent (checking the spec)",
    ]);
  });

  it("finds the agents already at work when the floor says resync", async () => {
    const { floor, scene, presence } = sceneOf({ open: ["run-1"] });

    scene.runs.set("run-1", {
      run: planningRun(),
      visits: [visit("decompose")],
    });
    floor.say({ type: "resync" });
    await until(() => scene.calls.length === 1);
    presence.stop();

    expect(scene.calls).toEqual([
      "open p1 Planning agent (splitting into tasks)",
    ]);
  });

  it("takes off a shown agent whose run the floor no longer lists as open on resync", async () => {
    const { floor, scene, presence } = sceneOf();

    scene.runs.set("run-1", { run: planningRun(), visits: [visit("analyze")] });
    floor.say({ type: "run_changed", runId: "run-1" });
    await until(() => scene.calls.length === 1);
    scene.runs.delete("run-1");
    floor.say({ type: "resync" });
    await until(() => scene.calls.length === 2);
    presence.stop();

    expect(scene.calls[1]).toBe("close p1");
  });

  it("opens again on the next change after an open failed", async () => {
    const { floor, scene, presence } = sceneOf({ failingOpens: 1 });

    scene.runs.set("run-1", { run: planningRun(), visits: [visit("analyze")] });
    floor.say({ type: "run_changed", runId: "run-1" });
    await presence.settled();
    floor.say({ type: "run_changed", runId: "run-1" });
    await until(() => scene.calls.length === 1);
    presence.stop();

    expect(scene.calls).toEqual(["open p1 Planning agent (writing the plan)"]);
  });

  it("takes the agent off the plan when the floor no longer holds its run", async () => {
    const { floor, scene, presence } = sceneOf();

    scene.runs.set("run-1", { run: planningRun(), visits: [visit("analyze")] });
    floor.say({ type: "run_changed", runId: "run-1" });
    await until(() => scene.calls.length === 1);
    scene.runs.delete("run-1");
    floor.say({ type: "run_changed", runId: "run-1" });
    await until(() => scene.calls.length === 2);
    presence.stop();

    expect(scene.calls[1]).toBe("close p1");
  });

  it("closes again on the next change after a close failed", async () => {
    const { floor, scene, presence } = sceneOf({ failingCloses: 1 });
    const idle = { run: planningRun(), visits: [reported("analyze")] };

    scene.runs.set("run-1", { run: planningRun(), visits: [visit("analyze")] });
    floor.say({ type: "run_changed", runId: "run-1" });
    await until(() => scene.calls.length === 1);
    scene.runs.set("run-1", idle);
    floor.say({ type: "run_changed", runId: "run-1" });
    await presence.settled();
    floor.say({ type: "run_changed", runId: "run-1" });
    await until(() => scene.calls.length === 2);
    presence.stop();

    expect(scene.calls).toEqual([
      "open p1 Planning agent (writing the plan)",
      "close p1",
    ]);
  });
});
