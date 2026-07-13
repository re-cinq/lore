import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { FileLeaseBackend } from "@re-cinq/lore-shared";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { AssemblyLine } from "@re-cinq/lore-assembly-lines";
import {
  runFloorAssemblyLine,
  checkoutBranch,
  portTrace,
  supervisorOutcome,
} from "./floor-assembly-line-run.js";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import type {
  FloorAssemblyLineTask,
  FloorAssemblyLinePorts,
} from "./floor-assembly-line.js";

const execFile = promisify(execFileCb);

// agent → github_action → retrospective → done (CI red loops back to the agent once).
const assemblyLine: AssemblyLine = {
  name: "floor-assembly-line-test",
  description: "test",
  version: 1,
  entry: "implement",
  exit: "done",
  nodes: [
    { id: "implement", type: "agent", prompt_ref: "implementation" },
    { id: "ci", type: "github_action" },
    { id: "wrap", type: "retrospective" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "implement", to: "ci", on: "success" },
    { from: "ci", to: "wrap", on: "success" },
    { from: "ci", to: "implement", on: "failed", iteration_max: 1 },
    { from: "wrap", to: "done", on: "always" },
  ],
};

const task: FloorAssemblyLineTask = {
  taskId: "abcdef1234567890",
  assemblyLineId: "a1b2c3d4e5f6a7b8",
  taskType: "implementation",
  description: "Implement the spec",
  targetRepo: "re-cinq/lore",
  branch: "lore/impl-abcdef12",
};

// Local integration test: runFloorAssemblyLine drives the real supervisor (lease + assembly line walk +
// git stage-commits + resume) with a temp repo + FileLeaseBackend, and the cluster ports
// faked — exactly what the minikube smoke test backs with real Agent CRs.
describe("runFloorAssemblyLine (local integration — cluster ports faked)", () => {
  let workDir: string;
  let repoDir: string;
  let leasesDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "lore-floor-assembly-line-"),
    );
    leasesDir = path.join(workDir, "leases");
    repoDir = path.join(workDir, "repo");
    await fs.mkdir(leasesDir, { recursive: true });
    await fs.mkdir(repoDir);
    await execFile("git", ["-C", repoDir, "init", "-b", "main"]);
    await execFile("git", ["-C", repoDir, "config", "user.email", "t@e.com"]);
    await execFile("git", ["-C", repoDir, "config", "user.name", "t"]);
    await fs.writeFile(path.join(repoDir, "README.md"), "x\n");
    await execFile("git", ["-C", repoDir, "add", "."]);
    await execFile("git", ["-C", repoDir, "commit", "-m", "init"]);
    await execFile("git", ["-C", repoDir, "checkout", "-b", task.branch]);
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  function ports(over: Partial<FloorAssemblyLinePorts> = {}) {
    const dispatched: LoreTaskSpec[] = [];
    const base: FloorAssemblyLinePorts = {
      dispatchAgent: async (spec) => {
        dispatched.push(spec);
      },
      resolvePrompt: (node) => `prompt:${node.id}`,
      agentStatus: async () => ({ phase: "Succeeded" }),
      ciConclusion: async () => "success",
      heartbeat: async () => {},
      sleep: async () => {},
      episodeDeps: {
        writeEpisode: async () => "ep",
        writeEpisodeWithCuration: async () => undefined,
        curate: false,
      },
      ...over,
    };

    return { ports: base, dispatched };
  }

  it("walks agent → github_action → retrospective, dispatching a per-node Agent + committing stages", async () => {
    const { ports: p, dispatched } = ports();
    const result = await runFloorAssemblyLine({
      task,
      assemblyLine,
      gitDir: repoDir,
      holder: "test-floor",
      leaseBackend: new FileLeaseBackend(leasesDir),
      ports: p,
    });

    expect(result.reason).toBe("completed");
    expect(result.summary?.reachedExit).toBe(true);
    // `done` is the exit marker — reached, not executed.
    expect(result.summary?.visited.map((v) => v.nodeId)).toEqual([
      "implement",
      "ci",
      "wrap",
    ]);

    // Every node dispatches its own CR — the agent runs the LLM, github_action +
    // retrospective are stations (ADR-031 amendment: no in-process node handlers).
    expect(dispatched).toHaveLength(3);
    expect(dispatched[0]).toMatchObject({
      name: "a1b2c3d4-implement",
      prompt: "prompt:implement",
    });
    expect(dispatched[1]).toMatchObject({
      name: "a1b2c3d4-ci",
      stationRef: "def-github-action",
    });
    expect(dispatched[2]).toMatchObject({
      name: "a1b2c3d4-wrap",
      stationRef: "def-retrospective",
    });

    // Branch-as-state: stage commits with trailers landed on the branch.
    const log = await execFile("git", ["-C", repoDir, "log", "--format=%B"]);

    expect(log.stdout).toContain("Lore-Stage: implement");
    expect(log.stdout).toContain("Lore-Stage: ci");
    expect(log.stdout).toContain("Lore-Task: abcdef1234567890");
    expect(log.stdout).toContain("Lore-Assembly-Line: a1b2c3d4e5f6a7b8");

    // Lease released cleanly.
    expect(await fs.readdir(leasesDir)).toHaveLength(0);
  });

  it("traces every node into the assembly lines port with the CR name and stage-commit sha", async () => {
    const { ports: p } = ports();
    const port = new InMemoryAssemblyLines();
    const result = await runFloorAssemblyLine({
      task,
      assemblyLine,
      gitDir: repoDir,
      holder: "test-floor",
      leaseBackend: new FileLeaseBackend(leasesDir),
      ports: p,
      trace: portTrace(port),
    });

    expect(result.reason).toBe("completed");
    expect(port.nodes.map((n) => n.nodeId)).toEqual([
      "implement",
      "ci",
      "wrap",
    ]);
    expect(port.nodes[0]).toMatchObject({
      assemblyLineId: "a1b2c3d4e5f6a7b8",
      agentCrName: "a1b2c3d4-implement",
      outcome: "success",
    });

    // Every node row carries the sha of its stage commit on the real branch.
    for (const node of port.nodes) {
      expect(node.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(node.finishedAt).not.toBeNull();
    }
  });

  it("supervisorOutcome maps supervisor reasons onto row outcomes", () => {
    expect(supervisorOutcome({ ranWork: true, reason: "completed" })).toBe(
      "completed",
    );
    expect(supervisorOutcome({ ranWork: false, reason: "lease_held" })).toBe(
      "lease_held",
    );
    expect(
      supervisorOutcome({ ranWork: true, reason: "iteration_max_exceeded" }),
    ).toBe("iteration_max");
    expect(
      supervisorOutcome({ ranWork: true, reason: "executor_pending" }),
    ).toBe("pending");
    expect(supervisorOutcome({ ranWork: true, reason: "executor_error" })).toBe(
      "error",
    );
  });

  it("loops back to the agent when the CI station reports failed, then proceeds once it passes", async () => {
    let ciAttempt = 0;
    // The github_action station is a pod now; its outcome rides the LORE_NODE_RESULT
    // line in Agent.status.output. Fail the first ci run, pass the second.
    const { ports: p, dispatched } = ports({
      agentStatus: async (_alId, nodeId) => {
        if (nodeId === "ci") {
          const outcome = ciAttempt++ === 0 ? "failed" : "success";

          return {
            phase: "Succeeded",
            output: `LORE_NODE_RESULT: {"outcome":"${outcome}","extras":{}}`,
          };
        }

        return { phase: "Succeeded" };
      },
    });
    const result = await runFloorAssemblyLine({
      task,
      assemblyLine,
      gitDir: repoDir,
      holder: "test-floor",
      leaseBackend: new FileLeaseBackend(leasesDir),
      ports: p,
    });

    expect(result.reason).toBe("completed");
    // implement → ci(failed) → implement → ci(success) → wrap → [done exit]
    expect(result.summary?.visited.map((v) => v.nodeId)).toEqual([
      "implement",
      "ci",
      "implement",
      "ci",
      "wrap",
    ]);
    expect(
      dispatched.filter((d) => d.name === "a1b2c3d4-implement"),
    ).toHaveLength(2); // agent ran twice
  });
});

// checkoutBranch clones the task's working tree. A task's FIRST run has no branch yet,
// so it must bootstrap one off the default; a resumed task must check out the existing
// branch to read its stage-commit trailers. Real git, local repo as the "remote".
describe("checkoutBranch (resume existing / bootstrap new)", () => {
  let work: string;
  let origin: string;

  async function currentBranch(dir: string): Promise<string> {
    const { stdout } = await execFile("git", [
      "-C",
      dir,
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);

    return stdout.trim();
  }

  beforeEach(async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), "lore-checkout-"));
    origin = path.join(work, "origin");
    await fs.mkdir(origin);
    await execFile("git", ["-C", origin, "init", "-b", "main"]);
    await execFile("git", ["-C", origin, "config", "user.email", "t@e.com"]);
    await execFile("git", ["-C", origin, "config", "user.name", "t"]);
    await fs.writeFile(path.join(origin, "README.md"), "x\n");
    await execFile("git", ["-C", origin, "add", "."]);
    await execFile("git", ["-C", origin, "commit", "-m", "init"]);
  });

  afterEach(async () => {
    await fs.rm(work, { recursive: true, force: true });
  });

  it("bootstraps a new branch off the default when it does not exist on the remote", async () => {
    const dir = await checkoutBranch(
      "re-cinq/lore",
      "lore/general/new-task-abcd1234",
      origin,
    );

    expect(await currentBranch(dir)).toBe("lore/general/new-task-abcd1234");
  });

  it("checks out the existing branch to resume its stage-commit history", async () => {
    await execFile("git", [
      "-C",
      origin,
      "checkout",
      "-b",
      "lore/general/existing-task",
    ]);
    await fs.writeFile(path.join(origin, "stage.txt"), "done\n");
    await execFile("git", ["-C", origin, "add", "."]);
    await execFile("git", [
      "-C",
      origin,
      "commit",
      "-m",
      "stage",
      "-m",
      "Lore-Stage: implement",
    ]);
    await execFile("git", ["-C", origin, "checkout", "main"]);

    const dir = await checkoutBranch(
      "re-cinq/lore",
      "lore/general/existing-task",
      origin,
    );

    expect(await currentBranch(dir)).toBe("lore/general/existing-task");
    const { stdout } = await execFile("git", ["-C", dir, "log", "--format=%B"]);

    expect(stdout).toContain("Lore-Stage: implement");
  });
});
