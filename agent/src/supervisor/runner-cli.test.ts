import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

// Mock the heavy collaborators so the test exercises only the dispatch
// logic in main(): env validation, workflow lookup, and reason → exit
// code mapping. The supervisor itself is well-tested elsewhere.
const runSupervisorMock = vi.fn();
vi.mock("./index.js", () => ({
  runSupervisor: (...args: unknown[]) => runSupervisorMock(...args),
}));

const loadWorkflowDirMock = vi.fn();
vi.mock("../workflow/loader.js", () => ({
  loadWorkflowDir: (...args: unknown[]) => loadWorkflowDirMock(...args),
}));

vi.mock("../config.js", () => ({
  loadTaskTypes: () => undefined,
  getTaskTypeConfig: () => ({ name: "implementation" }),
  buildPrompt: () => "p",
}));

vi.mock("../db.js", () => ({
  initPool: () => undefined,
  query: async () => [],
  queryOne: async () => null,
}));

const { main, MissingEnvError } = await import(
  "./runner-cli.js"
);

const REQUIRED = {
  LORE_DARK_FACTORY_WORKFLOW: "implementation",
  LORE_TASK_ID: "task-uuid",
  TARGET_REPO: "owner/repo",
  BRANCH_NAME: "lore/implementation/x",
  TASK_DESCRIPTION: "do thing",
  TASK_TYPE: "implementation",
};

let savedEnv: Record<string, string | undefined>;
let workdir: string;

beforeEach(() => {
  savedEnv = { ...process.env };
  workdir = mkdtempSync(path.join(tmpdir(), "runner-cli-"));
  mkdirSync(path.join(workdir, ".git"));
  process.env.WORKDIR = workdir;
  for (const [k, v] of Object.entries(REQUIRED)) process.env[k] = v;
  delete process.env.LORE_DB_HOST;
  delete process.env.TASK_TYPES_PATH;

  loadWorkflowDirMock.mockReset();
  runSupervisorMock.mockReset();
  loadWorkflowDirMock.mockResolvedValue(
    new Map([
      [
        "implementation",
        { name: "implementation", start: "n1", nodes: [], edges: [] },
      ],
    ]),
  );
});

afterEach(() => {
  process.env = savedEnv;
});

describe("runner-cli main()", () => {
  it("throws MissingEnvError when LORE_DARK_FACTORY_WORKFLOW is unset", async () => {
    delete process.env.LORE_DARK_FACTORY_WORKFLOW;
    await expect(main()).rejects.toBeInstanceOf(MissingEnvError);
  });

  it("throws MissingEnvError when LORE_TASK_ID is unset", async () => {
    delete process.env.LORE_TASK_ID;
    await expect(main()).rejects.toBeInstanceOf(MissingEnvError);
  });

  it("returns 2 when WORKDIR is not a git working tree", async () => {
    const bare = mkdtempSync(path.join(tmpdir(), "no-git-"));
    process.env.WORKDIR = bare;
    expect(await main()).toBe(2);
  });

  it("returns 3 when workflow loading throws", async () => {
    loadWorkflowDirMock.mockRejectedValueOnce(new Error("yaml parse fail"));
    expect(await main()).toBe(3);
  });

  it("returns 4 when workflow name is not in the loaded set", async () => {
    process.env.LORE_DARK_FACTORY_WORKFLOW = "no-such-workflow";
    expect(await main()).toBe(4);
  });

  it("returns 0 on supervisor reason=completed", async () => {
    runSupervisorMock.mockResolvedValue({ reason: "completed", ranWork: true });
    expect(await main()).toBe(0);
  });

  it("returns 5 on supervisor reason=lease_held", async () => {
    runSupervisorMock.mockResolvedValue({
      reason: "lease_held",
      ranWork: false,
    });
    expect(await main()).toBe(5);
  });

  it("returns 6 on supervisor reason=iteration_max_exceeded", async () => {
    runSupervisorMock.mockResolvedValue({
      reason: "iteration_max_exceeded",
      ranWork: true,
    });
    expect(await main()).toBe(6);
  });

  it("returns 7 on supervisor reason=executor_error", async () => {
    runSupervisorMock.mockResolvedValue({
      reason: "executor_error",
      ranWork: true,
      errorMessage: "boom",
    });
    expect(await main()).toBe(7);
  });

  it("returns 8 on supervisor reason=executor_pending", async () => {
    runSupervisorMock.mockResolvedValue({
      reason: "executor_pending",
      ranWork: false,
    });
    expect(await main()).toBe(8);
  });
});
