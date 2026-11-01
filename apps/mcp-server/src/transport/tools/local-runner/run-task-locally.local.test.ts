import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { registerRunTaskLocallyTool } from "./run-task-locally.local.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import {
  createTestMachine,
  enterDirectory,
  installFakeClaude,
  readLoreFile,
  resetMachine,
  writeLoreFile,
} from "./shared/test-machine.js";

const machine = createTestMachine();
const runTaskLocally = toolHandlers(registerRunTaskLocallyTool, "full")[
  "lore_run_task_locally"
];

beforeEach(() => {
  vi.stubEnv("HOME", machine.home);
  vi.stubEnv("PATH", `${machine.bin}:${process.env.PATH}`);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  resetMachine(machine);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function settled(): Promise<void> {
  await vi.waitFor(
    () => {
      const [task] = readLoreFile(machine, "local-tasks.json") as {
        status: string;
      }[];

      expect(task.status).not.toBe("running");
    },
    { timeout: 10_000 },
  );
}

describe("lore_run_task_locally", () => {
  it("refuses outside a git checkout with a GitHub remote", async () => {
    enterDirectory(machine);

    const result = await runTaskLocally({ description: "fix the parser" });

    expect(result.content[0].text).toBe(
      "Error: not in a git repository with a GitHub remote",
    );
  });

  it("warns when the description names acme/gadget but the checkout is acme/widget", async () => {
    enterDirectory(machine, { remote: "git@github.com:acme/widget.git" });

    const result = await runTaskLocally({
      description: "fix acme/gadget#12 parser crash",
    });

    expect(result.content[0].text).toBe(
      "Warning: This task references acme/gadget but you're in acme/widget. Switch to the target repo first:\n  cd /path/to/gadget && claude",
    );
  });

  it("starts a run on a lore/local branch in a worktree when the description names the checkout's own repo", async () => {
    enterDirectory(machine, { remote: "git@github.com:acme/widget.git" });
    installFakeClaude(machine);

    const result = await runTaskLocally({
      description: "fix acme/widget#12 parser crash",
      model: "claude-opus-4-6",
    });

    await settled();

    expect(result.content[0].text).toMatch(
      new RegExp(
        `^Task running locally in background\\.\\n\\nTask ID: [0-9a-f-]{36}\\nBranch: lore/local/fix-acme-widget-12-parser-crash-[0-9a-f]{8}\\nWorktree: ${machine.loreDir}/worktrees/`,
      ),
    );
  });

  it("starts a run when the description names no repo at all", async () => {
    enterDirectory(machine, { remote: "https://github.com/acme/widget.git" });
    installFakeClaude(machine);

    const result = await runTaskLocally({ description: "tidy the README" });

    await settled();

    expect(result.content[0].text).toMatch(
      /^Task running locally in background\./,
    );
  });

  it("reports the error when ~/.lore/worktrees is a file, not a directory", async () => {
    enterDirectory(machine, { remote: "git@github.com:acme/widget.git" });
    writeLoreFile(machine, "worktrees", "not a directory");

    const result = await runTaskLocally({ description: "tidy the README" });

    expect(result.content[0].text).toMatch(/^Error: EEXIST/);
  });
});
