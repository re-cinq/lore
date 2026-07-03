import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Octokit } from "octokit";
import { runSupervisor } from "./index.js";
import { FileLeaseBackend } from "@re-cinq/lore-shared";
import { parseAssemblyLine } from "./loader.js";
import { createAgentHandler } from "./agent-handler.js";
import { createDetectHandler } from "./detect-handler.js";
import { builtinHandlers } from "./assembly-line-executor.js";
import { createProductionHandlers } from "./handlers.js";
import type { LlmCompletion } from "@re-cinq/lore-shared";

const execFile = promisify(execFileCb);

const linearAssemblyLine = parseAssemblyLine(`
name: gap-fill-test
description: test fixture
version: 1
entry: draft
exit: done
nodes:
  - id: draft
    type: agent
    prompt_ref: gap-fill
  - id: validate
    type: validate
  - id: retrospective
    type: retrospective
  - id: done
    type: retrospective
edges:
  - from: draft
    to: validate
    on: success
  - from: validate
    to: retrospective
    on: success
  - from: retrospective
    to: done
    on: always
`);

function llm(text: string): LlmCompletion {
  return {
    text,
    inputTokens: 1,
    outputTokens: 1,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    durationMs: 1,
    model: "stub",
  };
}

/**
 * End-to-end test: runSupervisor walks a real assembly line with mocked LLM
 * + episode-writer + git, demonstrates a full chain from lease acquire
 * through agent handler → file write → stage commit → retrospective
 * episode → lease release.
 */
describe("supervisor integration (T058 vertical slice)", () => {
  let workDir: string;
  let leasesDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "lore-supervisor-"));
    leasesDir = path.join(workDir, "leases");
    await fs.mkdir(leasesDir, { recursive: true });
    // Initialize a git repo so the executor can commit.
    const repoDir = path.join(workDir, "repo");
    await fs.mkdir(repoDir);
    await execFile("git", ["-C", repoDir, "init", "-b", "main"]);
    await execFile("git", ["-C", repoDir, "config", "user.email", "test@example.com"]);
    await execFile("git", ["-C", repoDir, "config", "user.name", "test"]);
    await fs.writeFile(path.join(repoDir, "README.md"), "initial\n");
    await execFile("git", ["-C", repoDir, "add", "."]);
    await execFile("git", ["-C", repoDir, "commit", "-m", "initial"]);
    await execFile("git", [
      "-C",
      repoDir,
      "checkout",
      "-b",
      "lore/gap-fill/test",
    ]);
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it("runs the full chain: acquire → walk → commit → episode → release", async () => {
    const repoDir = path.join(workDir, "repo");
    const writeEpisode = vi.fn(async () => "episode-1");
    const evaluateAndMerge = vi.fn(async () => ({ outcome: "merged" }));

    const callLLM = vi.fn(async () =>
      llm(
        JSON.stringify({
          files: { "runbooks/test.md": "# test runbook\n" },
        }),
      ),
    );

    const agentHandler = createAgentHandler(
      {
        callLLM,
        resolvePrompt: () => ({
          systemPrompt: "draft a runbook",
          prompt: "do it",
        }),
      },
      { taskId: "t-1", description: "draft runbook", taskType: "gap-fill" },
    );

    const handlers = createProductionHandlers({
      agent: agentHandler,
      episodeDeps: {
        writeEpisode,
        writeEpisodeWithCuration: vi.fn(async () => undefined),
        curate: false,
        evaluateAndMerge,
        resolvePrForTask: async () => ({
          repo: "owner/repo",
          prNumber: 42,
          octokit: {} as Octokit, // unused by the stub evaluateAndMerge
          policy: {
            darkFactoryEnabled: true,
            autoMerge: {
              paths: ["runbooks/**"],
              min_trust: "docs",
              require_green_ci: true,
              require_bot_approval: true,
            },
            trustLevel: "docs",
            changedPaths: ["runbooks/test.md"],
            ciSucceeded: true,
            botApproved: true,
            humanChangesRequested: false,
          },
        }),
      },
    });

    const result = await runSupervisor({
      taskId: "t-1",
      assemblyLineId: "al-test-1",
      branchName: "lore/gap-fill/test",
      assemblyLineName: "gap-fill-test",
      gitDir: repoDir,
      holder: "test-pod",
      leaseBackend: new FileLeaseBackend(leasesDir),
      assemblyLine: linearAssemblyLine,
      handlers,
    });

    expect(result.ranWork).toBe(true);
    expect(result.reason).toBe("completed");
    expect(result.summary?.reachedExit).toBe(true);
    expect(result.summary?.visited.map((v) => v.nodeId)).toEqual([
      "draft",
      "validate",
      "retrospective",
    ]);

    // Lease was released cleanly (file gone).
    const remainingLeases = await fs.readdir(leasesDir);
    expect(remainingLeases).toHaveLength(0);

    // The agent handler wrote the file.
    expect(
      await fs.readFile(path.join(repoDir, "runbooks/test.md"), "utf-8"),
    ).toBe("# test runbook\n");

    // Episode was written.
    expect(writeEpisode).toHaveBeenCalledTimes(1);

    // Auto-merge engine was triggered (T021 + T023 wire-up).
    expect(evaluateAndMerge).toHaveBeenCalledTimes(1);
    const call = (evaluateAndMerge.mock.calls as unknown as Array<[{ repo: string; prNumber: number }]>)[0][0];
    expect(call.repo).toBe("owner/repo");
    expect(call.prNumber).toBe(42);

    // Stage commits exist on the branch with proper trailers.
    const log = await execFile("git", [
      "-C",
      repoDir,
      "log",
      "--format=%B",
      "--no-merges",
    ]);
    expect(log.stdout).toContain("Lore-Stage: draft");
    expect(log.stdout).toContain("Lore-Stage: validate");
    expect(log.stdout).toContain("Lore-Task: t-1");
    expect(log.stdout).toContain("Lore-Outcome: success");
    expect(log.stdout).toContain("Lore-Files-Written: 1");
  });

  it("walks a repo-less detect line: empty non-git dir, no-op commit, lease released", async () => {
    const detectLine = parseAssemblyLine(`
name: spec-drift
description: test fixture
version: 1
entry: detect
exit: done
nodes:
  - id: detect
    type: detect
    job_ref: spec_drift
  - id: done
    type: retrospective
edges:
  - from: detect
    to: done
    on: success
`);
    const emptyDir = path.join(workDir, "empty");
    await fs.mkdir(emptyDir);
    const commits: string[] = [];
    const detected: string[] = [];

    const result = await runSupervisor({
      taskId: "detect-1",
      assemblyLineId: "al-detect-1",
      branchName: "detect/spec-drift/owner/repo",
      assemblyLineName: "spec-drift",
      gitDir: emptyDir,
      holder: "test-pod",
      leaseBackend: new FileLeaseBackend(leasesDir),
      assemblyLine: detectLine,
      gitCommit: async (_dir, subject) => void commits.push(subject),
      handlers: {
        ...builtinHandlers,
        agent: async () => {
          throw new Error("detect lines have no agent nodes");
        },
        detect: createDetectHandler(
          {
            spec_drift: async ({ repo }) => {
              detected.push(repo);
              return "Checked 2 specs (0 drifted)";
            },
          },
          { repo: "owner/repo" },
        ),
      },
    });

    expect(result).toMatchObject({ ranWork: true, reason: "completed" });
    expect(result.summary?.reachedExit).toBe(true);
    expect(result.summary?.visited).toEqual([
      { nodeId: "detect", outcome: "success", iteration: 1 },
    ]);
    expect(detected).toEqual(["owner/repo"]);
    expect(commits).toEqual(["[stage:detect] iter=1"]);
    expect(await fs.readdir(leasesDir)).toHaveLength(0);
    expect(await fs.readdir(emptyDir)).toHaveLength(0);
  });

  it("returns executor_pending when handlers are not provided (legacy / lease-only mode)", async () => {
    const result = await runSupervisor({
      taskId: "t-2",
      assemblyLineId: "al-test-1",
      branchName: "lore/gap-fill/test",
      assemblyLineName: "gap-fill-test",
      holder: "test-pod",
      leaseBackend: new FileLeaseBackend(leasesDir),
    });
    expect(result.reason).toBe("executor_pending");
  });
});
