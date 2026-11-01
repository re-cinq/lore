import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { chmodSync } from "node:fs";
import { registerCancelLocalTaskTool } from "./cancel-local-task.local.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import {
  createTestMachine,
  enterDirectory,
  readLoreFile,
  resetMachine,
  writeLoreFile,
} from "./shared/test-machine.js";

const machine = createTestMachine();
const cancelLocalTask = toolHandlers(registerCancelLocalTaskTool, "full")[
  "lore_cancel_local_task"
];
const DEAD_PID = 2 ** 22 + 1;

function runningTask(taskId: string) {
  return {
    taskId,
    pid: DEAD_PID,
    branch: "lore/local/fix-a",
    repo: "acme/widget",
    worktreePath: `${machine.home}/no-worktree`,
    logFile: `${machine.home}/no-worktree.log`,
    startedAt: "2026-11-01T00:00:00Z",
    status: "running",
  };
}

beforeEach(() => {
  vi.stubEnv("HOME", machine.home);
  vi.spyOn(console, "error").mockImplementation(() => {});
  enterDirectory(machine);
});

afterEach(() => {
  resetMachine(machine);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("lore_cancel_local_task", () => {
  it("cancels running task task-1 and records it as cancelled by user", async () => {
    writeLoreFile(machine, "local-tasks.json", [runningTask("task-1")]);

    const result = await cancelLocalTask({ task_id: "task-1" });

    expect({
      text: result.content[0].text,
      stored: readLoreFile(machine, "local-tasks.json"),
    }).toMatchObject({
      text: "Task task-1 cancelled. Worktree cleaned up.",
      stored: [
        { taskId: "task-1", status: "failed", error: "Cancelled by user" },
      ],
    });
  });

  it("answers Could not cancel: Task not found for an id the machine never ran", async () => {
    const result = await cancelLocalTask({ task_id: "task-9" });

    expect(result.content[0].text).toBe("Could not cancel: Task not found");
  });

  it("reports the error when the task file cannot be rewritten", async () => {
    const file = writeLoreFile(machine, "local-tasks.json", [
      runningTask("task-1"),
    ]);

    chmodSync(file, 0o444);

    const result = await cancelLocalTask({ task_id: "task-1" });

    expect(result.content[0].text).toMatch(/^Error: EACCES/);
  });
});
