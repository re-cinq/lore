import { describe, it, expect } from "vitest";
import type {
  LoreTaskSpec,
  StationBackend,
  StationLaunchResult,
} from "@re-cinq/lore-shared";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import {
  shouldUseAssemblyLine,
  AgentCrStationBackend,
} from "./agent-cr-station-backend.js";

class FakeAssemblyLine implements StationBackend {
  readonly launched: string[] = [];
  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    this.launched.push(spec.taskType);

    return { ref: "assembly-line", launched: true };
  }
  async isActive(): Promise<boolean> {
    return true;
  }
}

/** The cluster's CRs, as the liveness probe sees them. */
class FakeAgents {
  readonly probed: string[] = [];
  constructor(private readonly agents: AgentCr[] = []) {}
  async listByLabel(selector: string): Promise<AgentCr[]> {
    this.probed.push(selector);

    return this.agents;
  }
}

const spec = (
  taskType: string,
  over: Partial<LoreTaskSpec> = {},
): LoreTaskSpec => ({
  taskId: "11111111-2222-3333-4444-555555555555",
  taskType,
  description: "write the runbook",
  prompt: "You are writing a runbook.",
  targetRepo: "o/r",
  branch: "lore/runbook/x",
  ...over,
});

const assemblyLineNames = new Set(["implementation", "general", "gap-fill"]);

function makeBackend(
  settings: Record<string, unknown> | null = null,
  agents = new FakeAgents(),
) {
  const runs = new InMemoryAssemblyRuns();
  const assemblyLine = new FakeAssemblyLine();
  const backend = new AgentCrStationBackend(
    assemblyLine,
    assemblyLineNames,
    runs,
    agents,
    async () => settings,
  );

  return { backend, assemblyLine, runs, agents };
}

/** The one open run row for a task, with its node rows. */
async function openRun(runs: InMemoryAssemblyRuns, taskId: string) {
  const run = (await runs.listForTask(taskId))[0];

  return { run, nodes: await runs.listStationRuns(run.id) };
}

describe("shouldUseAssemblyLine", () => {
  it("is true only when an assembly line exists for the task type", () => {
    expect(shouldUseAssemblyLine("implementation", assemblyLineNames)).toBe(
      true,
    );
    expect(shouldUseAssemblyLine("onboard", assemblyLineNames)).toBe(false);
  });

  it("routes gap-fill to the assembly line and runbook to single-Agent (no runbook.yaml)", () => {
    // Pins the post-migration split: gap-fill.yaml exists so gap-fill runs the
    // Floor-side line (per-node Agent CRs); runbook has no assembly line so it
    // stays a single Agent. A future stray runbook.yaml is then a conscious choice.
    expect(shouldUseAssemblyLine("gap-fill", assemblyLineNames)).toBe(true);
    expect(shouldUseAssemblyLine("runbook", assemblyLineNames)).toBe(false);
  });
});

describe("AgentCrStationBackend", () => {
  it("routes assemblyLine-having task types to the assembly line, others to single-Agent", async () => {
    const { backend, assemblyLine } = makeBackend();

    expect(await backend.launch(spec("implementation"))).toEqual({
      ref: "assembly-line",
      launched: true,
    });
    expect(await backend.launch(spec("onboard"))).toMatchObject({
      ref: "agent-11111111",
      launched: true,
    });
    expect(assemblyLine.launched).toEqual(["implementation"]);
  });

  it("enqueues a single-CR task as a claimable row instead of pushing a CR", async () => {
    const { backend, runs } = makeBackend();

    await backend.launch(spec("runbook"));
    const { run, nodes } = await openRun(runs, spec("runbook").taskId);

    expect(run).toMatchObject({ blueprintName: "runbook", repo: "o/r" });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      nodeId: "agent",
      iteration: 1,
      status: "queued",
      agentCrName: "agent-11111111",
      requiredTags: ["node:agent"],
      outcome: null,
    });
  });

  it("arms the row with the dispatch spec, named as the CR the row records", async () => {
    // The claim hands this object straight to the claiming cluster's launcher,
    // and both the watch's terminal report and the reconcile pass correlate by
    // that name — so the row and the spec must not be able to disagree.
    const { backend, runs } = makeBackend();

    await backend.launch(spec("runbook"));
    const claimed = await runs.claimNextStationRun({
      clusterAgentId: "central",
      tags: ["node:agent", "node:validate"],
    });

    expect(claimed).toMatchObject({
      nodeId: "agent",
      agentCrName: "agent-11111111",
    });
    expect(claimed?.dispatchSpec).toMatchObject({
      taskType: "runbook",
      targetRepo: "o/r",
      branch: "lore/runbook/x",
      name: "agent-11111111",
    });
  });

  it("records what the visit was dispatched with, so a pruned CR is not the only copy", async () => {
    const { backend, runs } = makeBackend();

    await backend.launch(spec("runbook"));
    const { nodes } = await openRun(runs, spec("runbook").taskId);

    expect(nodes[0].input).toEqual({
      description: "write the runbook",
      prompt: "You are writing a runbook.",
      params: null,
      repo: "o/r",
      ref: "lore/runbook/x",
    });
  });

  it("adds the repo's station_default_tags to the node's own type tag", async () => {
    const { backend, runs } = makeBackend({ station_default_tags: ["gpu"] });

    await backend.launch(spec("runbook"));
    const { nodes } = await openRun(runs, spec("runbook").taskId);

    expect(nodes[0].requiredTags).toEqual(["node:agent", "gpu"]);
  });

  it("converges a crash-recovery re-dispatch on one row rather than minting a second", async () => {
    // findRecoverable re-claims a mid-dispatch single-CR task. Under the push
    // path the re-launch hit the same CR name and 409'd; under the claim path
    // the guard has to be the row's own unique key.
    const { backend, runs } = makeBackend();

    await backend.launch(spec("runbook"));
    const second = await backend.launch(spec("runbook"));
    const { nodes } = await openRun(runs, spec("runbook").taskId);

    expect(await runs.listForTask(spec("runbook").taskId)).toHaveLength(1);
    expect(nodes).toHaveLength(1);
    expect(second).toEqual({ ref: "agent-11111111", launched: false });
  });

  it("does not re-arm a row another cluster already claimed", async () => {
    // A re-dispatch after the claim must not rewrite the spec out from under the
    // pod being built from it.
    const { backend, runs } = makeBackend();

    await backend.launch(spec("runbook"));
    await runs.claimNextStationRun({
      clusterAgentId: "central",
      tags: ["node:agent"],
    });
    await backend.launch(spec("runbook", { description: "REWRITTEN" }));
    const { nodes } = await openRun(runs, spec("runbook").taskId);

    expect(nodes[0].status).toBe("claimed");
    expect(nodes[0].input).toMatchObject({ description: "write the runbook" });
  });

  it("does not double-create a row for the assembly-line branch (start() lives in its backend)", async () => {
    const { backend, runs } = makeBackend();

    await backend.launch(spec("implementation"));

    expect(await runs.listForTask(spec("implementation").taskId)).toEqual([]);
  });

  it("probes liveness by task-id label, which finds both paths' Agents", async () => {
    const agents = new FakeAgents([{ metadata: { name: "a-1" } } as AgentCr]);
    const { backend } = makeBackend(null, agents);

    expect(await backend.isActive("task-9")).toBe(true);
    expect(agents.probed).toEqual(["lore.re-cinq.com/task-id=task-9"]);
  });
});
