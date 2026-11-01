import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { chmodSync } from "node:fs";
import { registerListLocalTasksTool } from "./list-local-tasks.local.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import {
  createTestMachine,
  resetMachine,
  writeLoreFile,
} from "./shared/test-machine.js";

const machine = createTestMachine();
const listLocalTasks = toolHandlers(registerListLocalTasksTool, "full")[
  "lore_list_local_tasks"
];
const DEAD_PID = 2 ** 22 + 1;

function task(overrides: Record<string, unknown>) {
  return {
    taskId: "aaaaaaaa-1111",
    pid: DEAD_PID,
    branch: "lore/local/fix-a",
    repo: "acme/widget",
    worktreePath: "/nowhere/aaaaaaaa",
    logFile: "/nowhere/aaaaaaaa.log",
    startedAt: "2026-11-01T00:00:00Z",
    status: "completed",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("HOME", machine.home);
});

afterEach(() => {
  resetMachine(machine);
  vi.unstubAllEnvs();
});

describe("lore_list_local_tasks", () => {
  it("answers No local tasks. when the machine has run none", async () => {
    const result = await listLocalTasks({});

    expect(result.content[0].text).toBe("No local tasks.");
  });

  it("lists a completed task with its PR and marks a running task whose process is gone as failed", async () => {
    writeLoreFile(machine, "local-tasks.json", [
      task({ prUrl: "https://github.com/acme/widget/pull/7" }),
      task({
        taskId: "bbbbbbbb-2222",
        branch: "lore/local/fix-b",
        status: "running",
      }),
    ]);

    const result = await listLocalTasks({});

    expect(result.content[0].text).toBe(
      [
        "aaaaaaaa completed acme/widget lore/local/fix-a → https://github.com/acme/widget/pull/7",
        "bbbbbbbb failed acme/widget lore/local/fix-b ✗ Process exited unexpectedly",
      ].join("\n"),
    );
  });

  it("reports the error when the task file cannot be rewritten", async () => {
    const file = writeLoreFile(machine, "local-tasks.json", [
      task({ status: "running" }),
    ]);

    chmodSync(file, 0o444);

    const result = await listLocalTasks({});

    expect(result.content[0].text).toMatch(/^Error: EACCES/);
  });
});
