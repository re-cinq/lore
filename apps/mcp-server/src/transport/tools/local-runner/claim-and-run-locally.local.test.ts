import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { registerClaimAndRunLocallyTool } from "./claim-and-run-locally.local.js";
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
const claimAndRun = toolHandlers(registerClaimAndRunLocallyTool, "full")[
  "lore_claim_and_run_locally"
];
const PENDING = {
  id: "c0ffee00-1234-4abc-8def-000000000001",
  description: "fix the parser crash",
  task_type: "runbook",
  target_repo: "acme/widget",
  created_at: "2026-11-01T00:00:00Z",
};

beforeEach(() => {
  vi.stubEnv("HOME", machine.home);
  vi.stubEnv("PATH", `${machine.bin}:${process.env.PATH}`);
  vi.stubEnv("LORE_API_URL", "");
  vi.stubEnv("LORE_INGEST_TOKEN", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  resetMachine(machine);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("lore_claim_and_run_locally", () => {
  it("answers not found when neither the pending cache nor the API knows task c0ffee00", async () => {
    const result = await claimAndRun({ task_id: "c0ffee00" });

    expect(result.content[0].text).toBe(
      "Task c0ffee00 not found or not in pending status. Run lore_list_pending_tasks first.",
    );
  });

  it("runs the cached task by its id prefix and takes it off the pending list", async () => {
    enterDirectory(machine, { remote: "git@github.com:acme/widget.git" });
    installFakeClaude(machine);
    writeLoreFile(machine, "pending-tasks.json", [PENDING]);

    const result = await claimAndRun({ task_id: "c0ffee00" });

    await vi.waitFor(
      () => {
        const [task] = readLoreFile(machine, "local-tasks.json") as {
          status: string;
        }[];

        expect(task.status).not.toBe("running");
      },
      { timeout: 10_000 },
    );

    expect({
      text: result.content[0].text,
      pending: readLoreFile(machine, "pending-tasks.json"),
    }).toMatchObject({
      text: expect.stringMatching(
        /^Claimed and running locally\.\n\nTask: c0ffee00-1234-4abc-8def-000000000001\nBranch: lore\/runbook\/fix-the-parser-crash-c0ffee00\n/,
      ),
      pending: [],
    });
  });

  it("refuses with the target_repo mismatch when the checkout is acme/gadget", async () => {
    enterDirectory(machine, { remote: "git@github.com:acme/gadget.git" });
    writeLoreFile(machine, "pending-tasks.json", [PENDING]);

    const result = await claimAndRun({ task_id: PENDING.id });

    expect(result.content[0].text).toBe(
      "Error: target_repo mismatch: task expects 'acme/widget' but current directory is a checkout of 'acme/gadget'. cd to a checkout of acme/widget before claiming this task.",
    );
  });

  it("refuses to make a worktree outside a git checkout", async () => {
    enterDirectory(machine);
    writeLoreFile(machine, "pending-tasks.json", [PENDING]);

    const result = await claimAndRun({ task_id: PENDING.id });

    expect(result.content[0].text).toBe(
      "Error: Not in a git repository — cannot create worktree",
    );
  });
});
