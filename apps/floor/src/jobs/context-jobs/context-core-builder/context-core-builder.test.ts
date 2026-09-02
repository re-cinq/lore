import { describe, it, expect, beforeEach, vi } from "vitest";
import { contextCoreBuilderJob } from "./context-core-builder.js";

const distinctTeams = vi.fn();
const countChunksByTeam = vi.fn();
const latest = vi.fn();
const insert = vi.fn();
const create = vi.fn();
const runPromptfooEval = vi.fn();

vi.mock("../../../kernel/queues.js", () => ({
  chunks: () => ({ distinctTeams, countChunksByTeam }),
  contextCore: () => ({ latest, insert }),
  taskStore: () => ({ create }),
}));

vi.mock("../lib/promptfoo.js", () => ({
  runPromptfooEval: (opts: unknown) => runPromptfooEval(opts),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  countChunksByTeam.mockResolvedValue(5);
});

describe("contextCoreBuilderJob", () => {
  it("promotes a namespace whose score improved past the threshold", async () => {
    distinctTeams.mockResolvedValue(["team-a"]);
    runPromptfooEval.mockResolvedValue({ ok: true, stats: { passRate: 0.9 } });
    latest.mockResolvedValue(0.5);

    const summary = await contextCoreBuilderJob();

    expect(summary).toBe(
      "Evaluated 1 namespaces: 1 promoted, 0 rejected, 0 unchanged",
    );
    expect(insert.mock.calls[0]?.[0]).toMatchObject({
      namespace: "team-a",
      evalScore: 0.9,
      status: "production",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a regressed namespace and files a gap-fill task", async () => {
    distinctTeams.mockResolvedValue(["team-a"]);
    runPromptfooEval.mockResolvedValue({ ok: true, stats: { passRate: 0.5 } });
    latest.mockResolvedValue(0.9);

    const summary = await contextCoreBuilderJob();

    expect(summary).toBe(
      "Evaluated 1 namespaces: 0 promoted, 1 rejected, 0 unchanged",
    );
    expect(insert.mock.calls[0]?.[0]).toMatchObject({
      status: "rejected-regression",
    });
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      taskType: "gap-fill",
      targetRepo: "team-a",
      createdBy: "context-core-builder",
    });
  });

  it("records a no-change insert when the delta crosses neither threshold", async () => {
    distinctTeams.mockResolvedValue(["team-a"]);
    runPromptfooEval.mockResolvedValue({ ok: true, stats: { passRate: 0.5 } });
    latest.mockResolvedValue(0.5);

    const summary = await contextCoreBuilderJob();

    expect(summary).toBe(
      "Evaluated 1 namespaces: 0 promoted, 0 rejected, 1 unchanged",
    );
    expect(insert.mock.calls[0]?.[0]).toMatchObject({ status: "no-change" });
  });

  it("counts a missing config and a crashed eval both as unchanged, logged apart", async () => {
    distinctTeams.mockResolvedValue(["team-a", "team-b"]);
    runPromptfooEval
      .mockResolvedValueOnce({ ok: false, reason: "config-missing" })
      .mockResolvedValueOnce({
        ok: false,
        reason: "exec-failed",
        error: "boom",
      });

    const summary = await contextCoreBuilderJob();

    expect(summary).toBe(
      "Evaluated 2 namespaces: 0 promoted, 0 rejected, 2 unchanged",
    );
    expect(insert).not.toHaveBeenCalled();
    expect(vi.mocked(console.log).mock.calls.flat()).toContain(
      "[job] context-core: no eval config for team-a, skipping",
    );
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain(
      "eval did not produce a score for team-b (exec-failed)",
    );
  });
});
