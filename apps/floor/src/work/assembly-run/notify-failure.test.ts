import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect } from "vitest";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { AuditLogEntry } from "../../outbound/audit.js";
import {
  isFailureOutcome,
  failureCause,
  failureNotice,
  notifyLineFailure,
} from "./notify-failure.js";
import { NO_FAILURE_CONTEXT, type FailureContext } from "./failure-context.js";

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
    subjectKey: null,
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
    const notice = failureNotice(lineRow(), "error", "node review failed", {
      uiUrl: "https://lore.example.com",
    });

    expect(notice.message).toContain("code-review");
    expect(notice.message).toContain("re-cinq/lore");
    expect(notice.message).toContain("error");
    expect(notice.message).toContain("node review failed");
    expect(notice.message).toContain(
      "https://lore.example.com/assembly-runs/al-1",
    );
  });

  it("carries the PR number and a comment with the @lore review re-run hint for code-review lines", () => {
    const notice = failureNotice(lineRow(), "error", undefined, {
      uiUrl: "https://lore.example.com",
    });

    expect(notice.prNumber).toBe(862);
    expect(notice.prComment).toContain(
      "https://lore.example.com/assembly-runs/al-1",
    );
    expect(notice.prComment).toContain("@lore review");
  });

  it("omits the re-run hint for an implementation line", () => {
    const notice = failureNotice(
      lineRow({ blueprintName: "implementation" }),
      "error",
      undefined,
    );

    expect(notice.prComment).not.toContain("@lore review");
  });

  it("carries the re-run hint on every line of the review family, not just code-review alone (a recheck's red check bore the review's name and said nothing about re-running)", () => {
    for (const blueprintName of [
      "code-review",
      "code-review-recheck",
      "code-review-reply",
      "comment-triage",
    ]) {
      const notice = failureNotice(
        lineRow({ blueprintName }),
        "error",
        undefined,
      );

      expect(notice.prComment).toContain("@lore review");
    }
  });

  it("yields no PR comment for a line without a pr_number", () => {
    const notice = failureNotice(
      lineRow({ blueprintName: "gap-detect", args: {} }),
      "error",
      "detect station exploded",
    );

    expect(notice).toMatchObject({ prNumber: null, prComment: null });
  });
});

describe("failureCause", () => {
  it("takes the category the failed node recorded over the run's reason", () => {
    const cause = failureCause(
      {
        nodeId: "review",
        failureClass: "anthropic-credit",
        failureDetail: null,
      },
      "DeadlineExceeded",
    );

    expect(cause).toMatchObject({
      nodeId: "review",
      category: "anthropic-credit",
    });
  });

  it("classifies the node's detail when the node recorded the unknown class", () => {
    const cause = failureCause(
      {
        nodeId: "implement",
        failureClass: "unknown",
        failureDetail:
          "Job has reached the specified backoff limit: BackoffLimitExceeded",
      },
      undefined,
    );

    expect(cause).toMatchObject({ nodeId: "implement", category: "infra" });
  });

  it("classifies the run's reason when no node failed", () => {
    expect(
      failureCause(null, "Your credit balance is too low to access the API"),
    ).toMatchObject({ nodeId: null, category: "anthropic-credit" });
  });

  it("returns unknown with its hint for a run with no node and no reason", () => {
    expect(failureCause(null, undefined)).toMatchObject({
      nodeId: null,
      category: "unknown",
      hint: expect.stringMatching(/pod logs/),
    });
  });
});

function context(overrides: Partial<FailureContext> = {}): FailureContext {
  return { ...NO_FAILURE_CONTEXT, ...overrides };
}

describe("failureNotice, classified", () => {
  it("names the category, the failing node and the hint", () => {
    const notice = failureNotice(lineRow(), "error", "node review failed", {
      context: context({
        failedNode: {
          nodeId: "review",
          failureClass: "infra",
          failureDetail: "DeadlineExceeded",
        },
      }),
    });

    expect(notice.message).toContain(
      "Pod or Job infrastructure failure at node `review`",
    );
    expect(notice.message).toContain(
      "Hint: The pod died rather than the work failing",
    );
  });

  it("links the run and the PR in Slack's link syntax", () => {
    const notice = failureNotice(lineRow(), "error", undefined, {
      uiUrl: "https://lore.example.com",
    });

    expect(notice.message).toContain(
      "<https://lore.example.com/assembly-runs/al-1|run al-1>",
    );
    expect(notice.message).toContain(
      "<https://github.com/re-cinq/lore/pull/862|PR #862>",
    );
  });

  it("links the task's PR and issue when the run carries no pr_number", () => {
    const notice = failureNotice(
      lineRow({ blueprintName: "implementation", args: {} }),
      "error",
      undefined,
      {
        context: context({
          prUrl: "https://github.com/re-cinq/lore/pull/901",
          issueUrl: "https://github.com/re-cinq/lore/issues/900",
        }),
      },
    );

    expect(notice.message).toContain(
      "<https://github.com/re-cinq/lore/pull/901|PR>",
    );
    expect(notice.message).toContain(
      "<https://github.com/re-cinq/lore/issues/900|issue>",
    );
  });

  it("names the owner when one is known", () => {
    const notice = failureNotice(lineRow(), "error", undefined, {
      context: context({ owner: "Ada Fixture" }),
    });

    expect(notice.message).toContain("Owner: Ada Fixture");
  });

  it("leaves the owner line out when nobody is known", () => {
    const notice = failureNotice(lineRow(), "error", undefined);

    expect(notice.message).not.toContain("Owner:");
  });

  it("quotes the failed node's own words once, not the run's reason that repeats the hint", () => {
    const notice = failureNotice(
      lineRow(),
      "iteration_max",
      'AssemblyLine code-review: node "review" failed: DeadlineExceeded — The pod died rather than the work failing',
      {
        context: context({
          failedNode: {
            nodeId: "review",
            failureClass: "infra",
            failureDetail: "DeadlineExceeded",
          },
        }),
      },
    );

    expect(notice.message.match(/The pod died/g)).toHaveLength(1);
    expect(notice.message).toContain("Reason: DeadlineExceeded");
  });

  it("escapes Slack's control characters in the reason", () => {
    const notice = failureNotice(
      lineRow(),
      "error",
      "tsc: Promise<string> & Array<number> mismatch",
    );

    expect(notice.message).toContain(
      "Reason: tsc: Promise&lt;string&gt; &amp; Array&lt;number&gt; mismatch",
    );
  });

  it("puts a multi-line reason in a code block so command output keeps its lines", () => {
    const notice = failureNotice(
      lineRow(),
      "error",
      "lint failed\nsrc/a.ts:3 no-unused-vars\nsrc/b.ts:9 complexity",
    );

    expect(notice.message).toContain(
      "Reason:\n```\nlint failed\nsrc/a.ts:3 no-unused-vars\nsrc/b.ts:9 complexity\n```",
    );
  });
});

interface Recorded {
  notified: Array<{ level: string; message: string }>;
  commented: Array<{ prNumber: number; body: string }>;
  audited: AuditLogEntry[];
}

function recordingPorts(
  behavior: {
    notifyThrows?: boolean;
    commentThrows?: boolean;
    contextThrows?: boolean;
  } = {},
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
        listRecentByType: async () => [],
      },
      uiUrl: "https://lore.example.com",
      context: async () => {
        enforceTrue(!behavior.contextThrows, Error, "db down");

        return context({ owner: "Ada Fixture" });
      },
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
        payload: { assembly_run_id: "al-1", channel: "notify" },
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

  it("posts the owner the context resolved", async () => {
    const recorder = recordingPorts();

    await notifyLineFailure(lineRow(), "error", undefined, recorder.ports);

    expect(recorder.notified[0]?.message).toContain("Owner: Ada Fixture");
  });

  it("still posts the failure when resolving its context throws", async () => {
    const recorder = recordingPorts({ contextThrows: true });

    await notifyLineFailure(lineRow(), "error", "boom", recorder.ports);

    expect(recorder.notified).toHaveLength(1);
    expect(recorder.notified[0]?.message).toContain("boom");
  });
});
