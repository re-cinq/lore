import { describe, it, expect, vi, beforeEach } from "vitest";

const writeAuditLogMock = vi.fn(async (_entry: unknown) => {});
const getMock = vi.fn();
const addLabelMock = vi.fn(async () => {});
const commentMock = vi.fn(async () => {});

vi.mock("../../outbound/audit.js", () => ({
  writeAuditLog: (entry: unknown) => writeAuditLogMock(entry),
}));

vi.mock("../../outbound/project-boot.js", () => ({
  projectFor: async () => ({
    pulls: { get: getMock, addLabel: addLabelMock, comment: commentMock },
  }),
}));

const { evaluateAndMerge } = await import("./auto-merge.js");

function escalatingJob(): Parameters<typeof evaluateAndMerge>[0] {
  return {
    taskId: "task-7",
    repo: "acme/pilot",
    prNumber: 12,
    policy: {
      autoMerge: {
        enabled: true,
        paths: ["apps/**"],
        escalate_paths: ["infra/**"],
        min_trust: "docs",
        require_green_ci: true,
        require_bot_approval: true,
      },
      trustLevel: "docs",
      changedPaths: ["apps/web/src/App.tsx", "infra/main.tf", "CLAUDE.md"],
      ciSucceeded: true,
      botApproved: true,
      humanChangesRequested: false,
      reviewInFlight: false,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockResolvedValue({ labels: [] });
});

describe("evaluateAndMerge on deferred:sensitive_path", () => {
  it("labels PR 12 needs-human-review", async () => {
    await evaluateAndMerge(escalatingJob());

    expect(addLabelMock).toHaveBeenCalledWith(12, "needs-human-review");
  });

  it("comments on PR 12 naming infra/main.tf and CLAUDE.md", async () => {
    await evaluateAndMerge(escalatingJob());

    expect(commentMock).toHaveBeenCalledWith(
      12,
      expect.stringMatching(/`infra\/main\.tf`[\s\S]*`CLAUDE\.md`/),
    );
  });

  it("neither labels nor comments again when PR 12 already carries needs-human-review", async () => {
    getMock.mockResolvedValue({ labels: ["needs-human-review"] });
    await evaluateAndMerge(escalatingJob());

    expect([addLabelMock.mock.calls, commentMock.mock.calls]).toEqual([[], []]);
  });

  it("writes infra/main.tf and CLAUDE.md into the auto_merge_decision audit row", async () => {
    await evaluateAndMerge(escalatingJob());

    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "auto_merge_decision",
        payload: expect.objectContaining({
          outcome: "deferred:sensitive_path",
          rule: expect.objectContaining({
            escalated_paths: ["infra/main.tf", "CLAUDE.md"],
          }),
        }),
      }),
    );
  });

  it("still writes the audit row when labelling PR 12 fails", async () => {
    addLabelMock.mockRejectedValueOnce(new Error("github 502"));
    const decision = await evaluateAndMerge(escalatingJob());

    expect([decision.outcome, writeAuditLogMock.mock.calls.length]).toEqual([
      "deferred:sensitive_path",
      1,
    ]);
  });
});
