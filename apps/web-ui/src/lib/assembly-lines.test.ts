import { describe, it, expect } from "vitest";
import {
  groupTasksIntoAssemblyLines,
  deriveAssemblyLineStatus,
  isSharedTrunk,
  statusVisual,
  formatDuration,
  formatRelativeTime,
  type AssemblyLineTaskRow,
} from "./assembly-lines";

const row = (over: Partial<AssemblyLineTaskRow>): AssemblyLineTaskRow => ({
  id: "task-1",
  description: "Implement the widget end to end",
  task_type: "implementation",
  status: "running",
  priority: "normal",
  target_repo: "re-cinq/lore",
  agent_id: "agent-abc",
  pr_url: null,
  pr_number: null,
  target_branch: null,
  parent_task_id: null,
  retry_of: null,
  created_by: "bogdan",
  created_at: "2026-06-01T12:00:00.000Z",
  updated_at: "2026-06-01T12:00:00.000Z",
  ...over,
});

const statuses = (...s: string[]) =>
  s.map((status, i) => row({ id: `m${i}`, status }));

describe("deriveAssemblyLineStatus", () => {
  it("returns running when any member is queued, pending, running or revision-requested", () => {
    expect(deriveAssemblyLineStatus(statuses("running"))).toBe("running");
    expect(deriveAssemblyLineStatus(statuses("queued"))).toBe("running");
    expect(deriveAssemblyLineStatus(statuses("pending"))).toBe("running");
    expect(deriveAssemblyLineStatus(statuses("running-local"))).toBe("running");
    expect(deriveAssemblyLineStatus(statuses("revision-requested"))).toBe(
      "running",
    );
  });

  it("returns failed when any member failed or was cancelled", () => {
    expect(deriveAssemblyLineStatus(statuses("merged", "failed"))).toBe(
      "failed",
    );
    expect(deriveAssemblyLineStatus(statuses("cancelled"))).toBe("failed");
  });

  it("returns needs-human when any member needs human help", () => {
    expect(
      deriveAssemblyLineStatus(statuses("merged", "needs-human-help")),
    ).toBe("needs-human");
  });

  it("returns merged when a member merged and none is in flight or failed", () => {
    expect(deriveAssemblyLineStatus(statuses("review", "merged"))).toBe(
      "merged",
    );
  });

  it("returns review when a member is in review and none is merged", () => {
    expect(deriveAssemblyLineStatus(statuses("pr-created", "review"))).toBe(
      "review",
    );
  });

  it("returns pr-created when a member opened a PR or completed", () => {
    expect(deriveAssemblyLineStatus(statuses("pr-created"))).toBe("pr-created");
    expect(deriveAssemblyLineStatus(statuses("completed"))).toBe("pr-created");
  });

  it("returns pending for an empty or unrecognised set", () => {
    expect(deriveAssemblyLineStatus([])).toBe("pending");
    expect(deriveAssemblyLineStatus(statuses("retried"))).toBe("pending");
  });

  it("lets an in-flight member win over a merged one", () => {
    expect(deriveAssemblyLineStatus(statuses("merged", "running"))).toBe(
      "running",
    );
  });
});

describe("isSharedTrunk", () => {
  it("is true for empty, main, master and develop regardless of case or padding", () => {
    expect(isSharedTrunk("")).toBe(true);
    expect(isSharedTrunk("main")).toBe(true);
    expect(isSharedTrunk(" Master ")).toBe(true);
    expect(isSharedTrunk("develop")).toBe(true);
  });

  it("is false for a feature branch", () => {
    expect(isSharedTrunk("lore/feature-x")).toBe(false);
  });
});

describe("groupTasksIntoAssemblyLines", () => {
  it("returns no runs for no tasks", () => {
    expect(groupTasksIntoAssemblyLines([])).toEqual([]);
  });

  it("wraps a lone task in a single-member assembly line", () => {
    const run = groupTasksIntoAssemblyLines([
      row({ id: "solo", pr_number: 3, pr_url: "u" }),
    ]);

    expect(run).toMatchObject([
      {
        runKey: "solo",
        prNumber: 3,
        prUrl: "u",
        targetRepo: "re-cinq/lore",
        status: "running",
      },
    ]);
    expect(run[0].members.map((m) => m.id)).toEqual(["solo"]);
    expect(run[0].lead.id).toBe("solo");
  });

  it("joins an implementation task and its review child linked by parent_task_id into one ordered run", () => {
    const impl = row({
      id: "impl",
      status: "merged",
      pr_number: 7,
      pr_url: "pr7",
      created_at: "2026-06-01T10:00:00.000Z",
    });
    const review = row({
      id: "review",
      task_type: "review",
      status: "running",
      parent_task_id: "impl",
      created_at: "2026-06-01T11:00:00.000Z",
    });
    const runs = groupTasksIntoAssemblyLines([review, impl]);

    expect(runs).toHaveLength(1);
    expect(runs[0].members.map((m) => m.id)).toEqual(["impl", "review"]);
    expect(runs[0].lead.id).toBe("impl");
    expect(runs[0]).toMatchObject({
      runKey: "impl",
      prNumber: 7,
      prUrl: "pr7",
      status: "running",
    });
  });

  it("joins tasks that share a repo and PR number even without an id link", () => {
    const a = row({ id: "a", pr_number: 9, target_branch: null });
    const b = row({ id: "b", pr_number: 9, target_branch: null });
    const runs = groupTasksIntoAssemblyLines([a, b]);

    expect(runs).toHaveLength(1);
    expect(runs[0].members.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("joins tasks that share a repo and feature branch", () => {
    const a = row({ id: "a", target_branch: "lore/feat" });
    const b = row({ id: "b", target_branch: "lore/feat" });

    expect(groupTasksIntoAssemblyLines([a, b])).toHaveLength(1);
  });

  it("does not join unrelated tasks that merely target the same trunk", () => {
    const a = row({ id: "a", target_branch: "main" });
    const b = row({ id: "b", target_branch: "main" });

    expect(groupTasksIntoAssemblyLines([a, b])).toHaveLength(2);
  });

  it("keeps a child whose parent is not on the page as its own run", () => {
    const orphan = row({ id: "orphan", parent_task_id: "gone" });
    const runs = groupTasksIntoAssemblyLines([orphan]);

    expect(runs).toHaveLength(1);
    expect(runs[0].members.map((m) => m.id)).toEqual(["orphan"]);
  });

  it("joins a retry to its original via retry_of", () => {
    const orig = row({ id: "orig", target_branch: null });
    const retry = row({ id: "retry", retry_of: "orig", target_branch: null });

    expect(groupTasksIntoAssemblyLines([orig, retry])).toHaveLength(1);
  });

  it("collapses a three-task chain (impl, review child, revision on the same branch) into one run", () => {
    const impl = row({
      id: "impl",
      target_branch: "lore/x",
      status: "merged",
      created_at: "2026-06-01T10:00:00.000Z",
    });
    const review = row({
      id: "review",
      target_branch: "lore/x",
      parent_task_id: "impl",
      status: "review",
      created_at: "2026-06-01T11:00:00.000Z",
    });
    const revision = row({
      id: "revision",
      target_branch: "lore/x",
      parent_task_id: "review",
      status: "running",
      created_at: "2026-06-01T12:00:00.000Z",
    });
    const runs = groupTasksIntoAssemblyLines([revision, review, impl]);

    expect(runs).toHaveLength(1);
    expect(runs[0].members.map((m) => m.id)).toEqual([
      "impl",
      "review",
      "revision",
    ]);
  });

  it("orders runs by lead creation time, newest first", () => {
    const older = row({
      id: "older",
      target_branch: "lore/a",
      created_at: "2026-06-01T08:00:00.000Z",
    });
    const newer = row({
      id: "newer",
      target_branch: "lore/b",
      created_at: "2026-06-02T08:00:00.000Z",
    });

    expect(
      groupTasksIntoAssemblyLines([older, newer]).map((r) => r.runKey),
    ).toEqual(["newer", "older"]);
  });

  it("takes the latest member updated_at as the run updatedAt", () => {
    const impl = row({
      id: "impl",
      target_branch: "lore/x",
      created_at: "2026-06-01T10:00:00.000Z",
      updated_at: "2026-06-01T10:30:00.000Z",
    });
    const child = row({
      id: "child",
      target_branch: "lore/x",
      created_at: "2026-06-01T11:00:00.000Z",
      updated_at: "2026-06-01T12:00:00.000Z",
    });
    const run = groupTasksIntoAssemblyLines([impl, child])[0];

    expect(run.startedAt).toBe("2026-06-01T10:00:00.000Z");
    expect(run.updatedAt).toBe("2026-06-01T12:00:00.000Z");
  });
});

describe("statusVisual", () => {
  it("maps every assembly-line status to a label and tone", () => {
    expect(statusVisual("merged")).toEqual({
      label: "Merged",
      tone: "success",
    });
    expect(statusVisual("failed")).toEqual({ label: "Failed", tone: "danger" });
    expect(statusVisual("running")).toEqual({
      label: "Running",
      tone: "running",
    });
    expect(statusVisual("needs-human")).toEqual({
      label: "Needs human",
      tone: "warning",
    });
    expect(statusVisual("review")).toEqual({
      label: "In review",
      tone: "info",
    });
    expect(statusVisual("pr-created")).toEqual({
      label: "PR created",
      tone: "info",
    });
    expect(statusVisual("pending")).toEqual({
      label: "Pending",
      tone: "muted",
    });
  });
});

describe("formatDuration", () => {
  it("formats the elapsed time as HH:MM:SS", () => {
    expect(
      formatDuration("2026-06-01T12:00:00.000Z", "2026-06-01T12:00:52.000Z"),
    ).toBe("00:00:52");
    expect(
      formatDuration("2026-06-01T12:00:00.000Z", "2026-06-01T13:01:01.000Z"),
    ).toBe("01:01:01");
  });

  it("clamps a non-positive span to zero", () => {
    expect(
      formatDuration("2026-06-01T12:00:00.000Z", "2026-06-01T11:00:00.000Z"),
    ).toBe("00:00:00");
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-06-02T00:00:00.000Z");

  it("reads just now under a minute", () => {
    expect(formatRelativeTime("2026-06-01T23:59:30.000Z", now)).toBe(
      "just now",
    );
  });

  it("pluralises minutes, hours, days, months and years", () => {
    expect(formatRelativeTime("2026-06-01T23:59:00.000Z", now)).toBe(
      "1 minute ago",
    );
    expect(formatRelativeTime("2026-06-01T23:50:00.000Z", now)).toBe(
      "10 minutes ago",
    );
    expect(formatRelativeTime("2026-06-01T13:00:00.000Z", now)).toBe(
      "11 hours ago",
    );
    expect(formatRelativeTime("2026-05-30T00:00:00.000Z", now)).toBe(
      "3 days ago",
    );
    expect(formatRelativeTime("2026-04-01T00:00:00.000Z", now)).toBe(
      "2 months ago",
    );
    expect(formatRelativeTime("2024-06-02T00:00:00.000Z", now)).toBe(
      "2 years ago",
    );
  });
});
