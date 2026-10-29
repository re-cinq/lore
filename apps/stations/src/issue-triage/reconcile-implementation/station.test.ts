import { describe, expect, it, vi } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { recordedPlanFloor } from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";
import {
  reconcileImplementationHandle,
  type ReconcileImplementationDeps,
} from "./station.js";
import type { IssueComment } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

const SHA = "a".repeat(40);
const MARKER = "<!-- lore-plan-task: spec-widgets/T001 -->";
const BRIEF = {
  visitId: "triage-1",
  iteration: 1,
  needs: { repo: "acme/widgets", issue_number: "42" },
};
const TOOLS: Tools = {
  read: async () => Buffer.alloc(0),
  produce: async () => {},
  modelCall: async () => {},
  signal: new AbortController().signal,
};

function scene(overrides: Partial<IssueRef> = {}) {
  const issue: IssueRef = {
    repo: "acme/widgets",
    number: 42,
    title: "Render widgets",
    state: "open",
    labels: ["lore-managed"],
    body: MARKER,
    ...overrides,
  };
  const comments: IssueComment[] = [];
  const comment = vi.fn(async (_number: number, body: string) => {
    comments.push({
      id: comments.length + 1,
      body,
      user: "lore",
      created_at: "2026-10-29T00:00:00Z",
    });
  });
  const addLabel = vi.fn(async (_number: number, _label: string) => {});
  const read = vi.fn(
    async (_path: string, _sha: string): Promise<string | null> => "# Widgets",
  );
  const project = {
    repo: { defaultBranch: async () => "main", headSha: async () => SHA, read },
    issues: {
      get: async () => issue,
      listComments: async () => comments,
      comment,
      addLabel,
    },
  };
  const recorded = recordedPlanFloor();
  const deps: ReconcileImplementationDeps = {
    project: async () => project,
    lines: recorded.floor.lines,
  };
  const visit = () => reconcileImplementationHandle(deps)(BRIEF, TOOLS);

  return { recorded, issue, comments, comment, addLabel, read, deps, visit };
}

describe("triage implementation reconciliation", () => {
  it("hands task 42 to spec-tickets at pinned main without queuing new work", async () => {
    const s = scene();

    expect(await s.visit()).toEqual({ outcome: "delegated" });
    expect(
      s.recorded.requests.find((request) => request.path.endsWith("/start")),
    ).toMatchObject({
      path: "/assembly-lines/spec-tickets/start",
      body: {
        repo: "github.com/acme/widgets",
        startItems: {
          target: {
            kind: "git",
            ref: `github.com/acme/widgets@${SHA}`,
            sha: SHA,
          },
          merge_sha: { ref: SHA },
          spec_path: { ref: "specs/widgets/spec.md" },
          queue: { ref: "false" },
        },
      },
    });
    expect({
      reads: s.read.mock.calls,
      labels: s.addLabel.mock.calls,
      comments: s.comments,
    }).toMatchObject({
      reads: [["specs/widgets/spec.md", SHA]],
      labels: [[42, "triage: needs-priority"]],
      comments: [
        {
          body: expect.stringContaining("Handoff is not a completion verdict"),
        },
      ],
    });
  });

  it.each([
    { labels: ["bug", "lore-managed"], body: MARKER },
    { labels: ["type: bug", "lore-managed"], body: MARKER },
    { labels: [], body: MARKER },
    { body: "A widget crashes on click" },
    { body: "<!-- lore-plan: spec-widgets -->" },
    { body: "<!-- lore-plan-task: spec-../escape/T001 -->" },
  ])("keeps $body with $labels on the reproduction path", async (overrides) => {
    const s = scene(overrides);

    expect(await s.visit()).toEqual({ outcome: "not-generated" });
    expect({
      floor: s.recorded.requests,
      comments: s.comments,
      labels: s.addLabel.mock.calls,
    }).toEqual({ floor: [], comments: [], labels: [] });
  });

  it("retries task 42 without a second handoff or comment at the same revision", async () => {
    const s = scene();

    await s.visit();
    await s.visit();

    expect({
      starts: s.recorded.requests.filter((request) =>
        request.path.endsWith("/start"),
      ).length,
      comments: s.comments.length,
    }).toEqual({ starts: 1, comments: 1 });
  });

  it("leaves task 42 unhandled when its source spec disappeared", async () => {
    const s = scene();

    s.read.mockResolvedValue(null);
    expect(await s.visit()).toMatchObject({
      outcome: "failed",
      error: expect.stringContaining("does not exist"),
    });
    expect({
      floor: s.recorded.requests,
      comments: s.comments,
      labels: s.addLabel.mock.calls,
    }).toEqual({ floor: [], comments: [], labels: [] });
  });

  it("leaves task 42 unhandled when the floor refuses the reconciliation", async () => {
    const s = scene();

    s.deps.lines = {
      start: async () => {
        throw new Error("floor unavailable");
      },
    };
    expect(await s.visit()).toMatchObject({
      outcome: "failed",
      error: "floor unavailable",
    });
    expect({ comments: s.comments, labels: s.addLabel.mock.calls }).toEqual({
      comments: [],
      labels: [],
    });
  });

  it("does not hand off or label task 42 after another actor closes it", async () => {
    const s = scene({ state: "closed" });

    expect(await s.visit()).toEqual({ outcome: "delegated" });
    expect({
      floor: s.recorded.requests,
      labels: s.addLabel.mock.calls,
    }).toEqual({ floor: [], labels: [] });
  });
});
