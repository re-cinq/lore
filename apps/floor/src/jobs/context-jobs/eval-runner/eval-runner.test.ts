import { describe, it, expect, beforeEach, vi } from "vitest";
import { evalRunnerJob } from "./eval-runner.js";

const record = vi.fn();
const recent = vi.fn();
const create = vi.fn();
const isPromptfooAvailable = vi.fn();
const runPromptfooEval = vi.fn();
const readdir = vi.fn();

vi.mock("../../../kernel/queues.js", () => ({
  evalRuns: () => ({ record, recent }),
  taskStore: () => ({ create }),
}));

vi.mock("../lib/promptfoo.js", () => ({
  isPromptfooAvailable: () => isPromptfooAvailable(),
  runPromptfooEval: (opts: unknown) => runPromptfooEval(opts),
}));

vi.mock("node:fs/promises", () => ({
  readdir: (dir: string) => readdir(dir),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  isPromptfooAvailable.mockResolvedValue(true);
  recent.mockResolvedValue([]);
});

describe("evalRunnerJob", () => {
  it("logs a crashed eval and a stat-less eval apart, skipping both teams", async () => {
    readdir.mockResolvedValue(["team-a", "team-b"]);
    runPromptfooEval
      .mockResolvedValueOnce({
        ok: false,
        reason: "exec-failed",
        error: "boom",
      })
      .mockResolvedValueOnce({ ok: false, reason: "no-results" });

    const summary = await evalRunnerJob();

    expect(summary).toBe("Evaluated 0 teams, 0 regressions detected");
    expect(record).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain(
      "eval failed for team team-a:",
    );
    expect(String(vi.mocked(console.error).mock.calls[1]?.[0])).toContain(
      "no usable stats for team team-b (no-results)",
    );
  });

  it("records a passing team's stats", async () => {
    readdir.mockResolvedValue(["team-a"]);
    runPromptfooEval.mockResolvedValue({
      ok: true,
      stats: { passRate: 0.75, total: 4, passes: 3 },
    });

    const summary = await evalRunnerJob();

    expect(summary).toBe("Evaluated 1 teams, 0 regressions detected");
    expect(record.mock.calls[0]?.[0]).toEqual({
      team: "team-a",
      pass_rate: 0.75,
      total_tests: 4,
      passed: 3,
      failed: 1,
    });
  });
});
