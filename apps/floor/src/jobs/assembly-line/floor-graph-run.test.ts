import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { FileLeaseBackend } from "@re-cinq/lore-shared";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { Workflow } from "@re-cinq/lore-runner";
import { runFloorGraph } from "./floor-graph-run.js";
import type { FloorGraphTask, FloorGraphPorts } from "./floor-graph.js";

const execFile = promisify(execFileCb);

// agent → github_action → retrospective → done (CI red loops back to the agent once).
const workflow: Workflow = {
  name: "floor-graph-test",
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

const task: FloorGraphTask = {
  taskId: "abcdef1234567890",
  taskType: "implementation",
  description: "Implement the spec",
  targetRepo: "re-cinq/lore",
  branch: "lore/impl-abcdef12",
};

// Local integration test: runFloorGraph drives the real supervisor (lease + graph walk +
// git stage-commits + resume) with a temp repo + FileLeaseBackend, and the cluster ports
// faked — exactly what the minikube smoke test backs with real Agent CRs.
describe("runFloorGraph (local integration — cluster ports faked)", () => {
  let workDir: string;
  let repoDir: string;
  let leasesDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "lore-floor-graph-"));
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

  function ports(over: Partial<FloorGraphPorts> = {}) {
    const dispatched: LoreTaskSpec[] = [];
    const base: FloorGraphPorts = {
      dispatchAgent: async (spec) => { dispatched.push(spec); },
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
    const result = await runFloorGraph({
      task,
      workflow,
      gitDir: repoDir,
      holder: "test-floor",
      leaseBackend: new FileLeaseBackend(leasesDir),
      ports: p,
    });

    expect(result.reason).toBe("completed");
    expect(result.summary?.reachedExit).toBe(true);
    // `done` is the exit marker — reached, not executed.
    expect(result.summary?.visited.map((v) => v.nodeId)).toEqual(["implement", "ci", "wrap"]);

    // The agent node dispatched exactly one per-node Agent CR with the node's prompt.
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ name: "abcdef12-implement", prompt: "prompt:implement" });

    // Branch-as-state: stage commits with trailers landed on the branch.
    const log = await execFile("git", ["-C", repoDir, "log", "--format=%B"]);
    expect(log.stdout).toContain("Lore-Stage: implement");
    expect(log.stdout).toContain("Lore-Stage: ci");
    expect(log.stdout).toContain("Lore-Task: abcdef1234567890");

    // Lease released cleanly.
    expect(await fs.readdir(leasesDir)).toHaveLength(0);
  });

  it("loops back to the agent when CI is red, then proceeds once it goes green", async () => {
    let ci = 0;
    const { ports: p, dispatched } = ports({ ciConclusion: async () => (ci++ === 0 ? "failure" : "success") });
    const result = await runFloorGraph({
      task,
      workflow,
      gitDir: repoDir,
      holder: "test-floor",
      leaseBackend: new FileLeaseBackend(leasesDir),
      ports: p,
    });

    expect(result.reason).toBe("completed");
    // implement → ci(red) → implement → ci(green) → wrap → [done exit]
    expect(result.summary?.visited.map((v) => v.nodeId)).toEqual([
      "implement", "ci", "implement", "ci", "wrap",
    ]);
    expect(dispatched).toHaveLength(2); // the agent node ran twice
  });
});
