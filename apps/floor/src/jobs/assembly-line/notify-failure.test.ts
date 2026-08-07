import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect } from "vitest";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { AuditLogEntry } from "../lib/audit.js";
import {
  isFailureOutcome,
  failureNotice,
  notifyLineFailure,
} from "./notify-failure.js";

function lineRow(
  overrides: Partial<AssemblyRunRecord> = {},
): AssemblyRunRecord {
  return {
    id: "al-1",
    graph: null,
    blueprintName: "code-review",
    taskId: null,
    repo: "re-cinq/lore",
    branch: "fix/thing",
    args: { pr_number: 862 },
    status: "failed",
    outcome: "error",
    reason: null,
    blueprintHash: null,
    resumedFromRunId: null,
    resumedFromNodeId: null,
    inheritedNodeCount: 0,
    createdAt: new Date("2026-07-17T06:20:00Z"),
    startedAt: new Date("2026-07-17T06:20:01Z"),
    finishedAt: null,
    ...overrides,
  };
}

describe("isFailureOutcome", () => {
  it("returns true for error, failed and iteration_max", () => {
    expect(isFailureOutcome("error")).toBe(true);
    expect(isFailureOutcome("failed")).toBe(true);
    expect(isFailureOutcome("iteration_max")).toBe(true);
  });

  it("returns false for completed, lease_held, pr_created, changes_requested and pr_closed", () => {
    expect(isFailureOutcome("completed")).toBe(false);
    expect(isFailureOutcome("lease_held")).toBe(false);
    expect(isFailureOutcome("pr_created")).toBe(false);
    expect(isFailureOutcome("changes_requested")).toBe(false);
    expect(isFailureOutcome("pr_closed")).toBe(false);
  });
});

describe("failureNotice", () => {
  it("builds a message carrying definition, repo, outcome, reason and the run link", () => {
    const notice = failureNotice(
      lineRow(),
      "error",
      "node review failed",
      "https://lore.example.com",
    );

    expect(notice.message).toContain("code-review");
    expect(notice.message).toContain("re-cinq/lore");
    expect(notice.message).toContain("error");
    expect(notice.message).toContain("node review failed");
    expect(notice.message).toContain(
      "https://lore.example.com/assembly-lines/al-1",
    );
  });

  it("carries the PR number and a comment with the @lore review re-run hint for code-review lines", () => {
    const notice = failureNotice(
      lineRow(),
      "error",
      undefined,
      "https://lore.example.com",
    );

    expect(notice.prNumber).toBe(862);
    expect(notice.prComment).toContain(
      "https://lore.example.com/assembly-lines/al-1",
    );
    expect(notice.prComment).toContain("@lore review");
  });

  it("omits the re-run hint for non-review definitions", () => {
    const notice = failureNotice(
      lineRow({ blueprintName: "comment-triage" }),
      "error",
      undefined,
      undefined,
    );

    expect(notice.prComment).not.toContain("@lore review");
  });

  it("yields no PR comment for a line without a pr_number", () => {
    const notice = failureNotice(
      lineRow({ blueprintName: "gap-detect", args: {} }),
      "error",
      "detect station exploded",
      undefined,
    );

    expect(notice).toMatchObject({ prNumber: null, prComment: null });
  });
});

interface Recorded {
  notified: Array<{ level: string; message: string }>;
  commented: Array<{ prNumber: number; body: string }>;
  audited: AuditLogEntry[];
}

function recordingPorts(
  behavior: { notifyThrows?: boolean; commentThrows?: boolean } = {},
): Recorded & {
  ports: Parameters<typeof notifyLineFailure>[3];
} {
  const recorded: Recorded = { notified: [], commented: [], audited: [] };

  return {
    ...recorded,
    ports: {
      notify: async (level: string, message: string) => {
        enforceTrue(!behavior.notifyThrows, Error, "slack down");
        recorded.notified.push({ level, message });
      },
      comment: async (prNumber: number, body: string) => {
        enforceTrue(!behavior.commentThrows, Error, "comment 403");
        recorded.commented.push({ prNumber, body });
      },
      audit: {
        write: async (entry: AuditLogEntry) => {
          recorded.audited.push(entry);
        },
      },
      uiUrl: "https://lore.example.com",
    },
  };
}

describe("notifyLineFailure", () => {
  it("sends the escalation notify and the PR comment for a failed PR-linked line", async () => {
    const recorder = recordingPorts();

    await notifyLineFailure(
      lineRow(),
      "error",
      "node review failed",
      recorder.ports,
    );

    expect(recorder.notified).toMatchObject([{ level: "escalation" }]);
    expect(recorder.notified[0]?.message).toContain("code-review");
    expect(recorder.commented).toMatchObject([{ prNumber: 862 }]);
    expect(recorder.commented[0]?.body).toContain("@lore review");
  });

  it("sends only the notify for a failed line without a PR", async () => {
    const recorder = recordingPorts();

    await notifyLineFailure(
      lineRow({ blueprintName: "gap-detect", args: {} }),
      "error",
      undefined,
      recorder.ports,
    );

    expect(recorder.notified).toHaveLength(1);
    expect(recorder.commented).toHaveLength(0);
  });

  it("still posts the PR comment and audits when the notify send throws", async () => {
    const recorder = recordingPorts({ notifyThrows: true });

    await notifyLineFailure(lineRow(), "error", undefined, recorder.ports);

    expect(recorder.commented).toHaveLength(1);
    expect(recorder.audited).toMatchObject([
      {
        event_type: "failure_notify_failed",
        repo: "re-cinq/lore",
        payload: { assembly_line_id: "al-1", channel: "notify" },
      },
    ]);
  });

  it("audits and resolves when the PR comment throws", async () => {
    const recorder = recordingPorts({ commentThrows: true });

    await notifyLineFailure(lineRow(), "error", undefined, recorder.ports);

    expect(recorder.notified).toHaveLength(1);
    expect(recorder.audited).toMatchObject([
      {
        event_type: "failure_notify_failed",
        payload: { channel: "comment", error: "comment 403" },
      },
    ]);
  });
});

describe("goal_gate_unmet rides the standard failure path", () => {
  it("classifies goal_gate_unmet as a failure", () => {
    expect(isFailureOutcome("goal_gate_unmet")).toBe(true);
  });

  it("notifies and comments on a PR-linked line closing goal_gate_unmet", async () => {
    const recorder = recordingPorts();

    await notifyLineFailure(
      lineRow({ outcome: "goal_gate_unmet" }),
      "goal_gate_unmet",
      'reached the exit with unsatisfied goal gate(s) "review"',
      recorder.ports,
    );

    expect({
      notified: recorder.notified,
      commented: recorder.commented,
    }).toMatchObject({
      notified: [
        {
          level: "escalation",
          message: expect.stringContaining("goal_gate_unmet"),
        },
      ],
      commented: [
        { prNumber: 862, body: expect.stringContaining("goal_gate_unmet") },
      ],
    });
  });
});
