import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "./assembly-runs-memory.js";
import type { ParkedTarget } from "./parked-node.js";
import {
  decideMergeResume,
  decideResumeFromClosedPr,
  resumeDecomposition,
} from "./decompose-resume.js";

const REPO = "re-cinq/lore";

const node = (nodeId: string, iteration: number, outcome: string | null) => ({
  nodeId,
  iteration,
  outcome,
});

const GRAPHLESS = null;

describe("decideMergeResume", () => {
  it("targets the merged node a pushed line is parked on", () => {
    expect(
      decideMergeResume(
        "line-1",
        "running",
        [node("push", 1, "success"), node("merged", 1, null)],
        GRAPHLESS,
      ),
    ).toEqual({ lineId: "line-1", nodeId: "merged", iteration: 1 });
  });

  it("targets a RENAMED wait node by its pr_review type from the run's graph", () => {
    expect(
      decideMergeResume(
        "line-1",
        "running",
        [node("await-spec-merge", 1, null)],
        {
          name: "feature-planning",
          entry: "push",
          exit: "await-spec-merge",
          nodes: [
            {
              id: "push",
              type: "validate",
              station: "def-github-action",
              station_inherited: true,
            },
            {
              id: "await-spec-merge",
              type: "pr_review",
              station: null,
              station_inherited: false,
            },
          ],
          edges: [],
        },
      ),
    ).toEqual({ lineId: "line-1", nodeId: "await-spec-merge", iteration: 1 });
  });

  it("ignores a line parked on the author rather than the merge", () => {
    expect(
      decideMergeResume(
        "line-1",
        "running",
        [node("author", 2, null)],
        GRAPHLESS,
      ),
    ).toBeNull();
  });

  it("ignores a merged node that already reported", () => {
    expect(
      decideMergeResume(
        "line-1",
        "running",
        [node("merged", 1, "success")],
        GRAPHLESS,
      ),
    ).toBeNull();
  });

  it("ignores a line that is no longer open", () => {
    expect(
      decideMergeResume(
        "line-1",
        "finished",
        [node("merged", 1, null)],
        GRAPHLESS,
      ),
    ).toBeNull();
  });
});

function recorder() {
  const events: (ParkedTarget & {
    outcome: string;
    args?: Record<string, unknown>;
  })[] = [];
  const report = async (
    target: ParkedTarget,
    outcome: string,
    args?: Record<string, unknown>,
  ) => {
    events.push({ ...target, outcome, ...(args ? { args } : {}) });
  };

  return { events, report };
}

async function lineParkedOnMerge(prNumber: number) {
  const lines = new InMemoryAssemblyRuns();
  const id = await lines.start({
    blueprintName: "feature-planning",
    repo: REPO,
    branch: "feature/x",
    args: { pr_number: prNumber, feature_id: "feat-1" },
  });

  await lines.markRunning(id);
  await lines.ensureStationRun({
    assemblyRunId: id,
    nodeId: "merged",
    iteration: 1,
  });

  return { lines, id };
}

describe("resumeDecomposition", () => {
  it("reports success to the parked merged node of the PR's line", async () => {
    const { lines, id } = await lineParkedOnMerge(42);
    const rec = recorder();

    await resumeDecomposition(
      { repo: REPO, prNumber: 42 },
      { assemblyRuns: lines, report: rec.report },
    );

    expect(rec.events).toEqual([
      { lineId: id, nodeId: "merged", iteration: 1, outcome: "success" },
    ]);
  });

  it("points the resumed line at main, the branch PR #42 merged into, since GitHub deletes the merged head branch the line still names", async () => {
    const { lines, id } = await lineParkedOnMerge(42);
    const rec = recorder();

    await resumeDecomposition(
      { repo: REPO, prNumber: 42, baseRef: "main" },
      { assemblyRuns: lines, report: rec.report },
    );

    expect(rec.events).toEqual([
      {
        lineId: id,
        nodeId: "merged",
        iteration: 1,
        outcome: "success",
        args: { ref: "main" },
      },
    ]);
  });

  it("does nothing when no open line claims the PR", async () => {
    const rec = recorder();

    await resumeDecomposition(
      { repo: REPO, prNumber: 999 },
      { assemblyRuns: new InMemoryAssemblyRuns(), report: rec.report },
    );

    expect(rec.events).toEqual([]);
  });

  it("does nothing when the PR's line is not parked on the merge", async () => {
    const lines = new InMemoryAssemblyRuns();
    const id = await lines.start({
      blueprintName: "implementation",
      repo: REPO,
      branch: "feature/y",
      args: { pr_number: 7 },
    });

    await lines.markRunning(id);
    await lines.ensureStationRun({
      assemblyRunId: id,
      nodeId: "review",
      iteration: 1,
    });
    const rec = recorder();

    await resumeDecomposition(
      { repo: REPO, prNumber: 7 },
      { assemblyRuns: lines, report: rec.report },
    );

    expect(rec.events).toEqual([]);
  });

  it("reports once even when the PR has several open lines", async () => {
    const { lines, id } = await lineParkedOnMerge(42);
    const reviewId = await lines.start({
      blueprintName: "code-review",
      repo: REPO,
      branch: "feature/x",
      args: { pr_number: 42 },
    });

    await lines.markRunning(reviewId);
    const rec = recorder();

    await resumeDecomposition(
      { repo: REPO, prNumber: 42 },
      { assemblyRuns: lines, report: rec.report },
    );

    expect(rec.events).toEqual([
      { lineId: id, nodeId: "merged", iteration: 1, outcome: "success" },
    ]);
  });
});

describe("decideResumeFromClosedPr", () => {
  it("resumes for a merged PR, naming the repo and number findOpenByPr matches on", () => {
    expect(
      decideResumeFromClosedPr({
        repo: REPO,
        pr_number: 1225,
        merged: true,
      }),
    ).toEqual({ repo: REPO, prNumber: 1225 });
  });

  it("carries the branch PR #1225 merged into as baseRef", () => {
    expect(
      decideResumeFromClosedPr({
        repo: REPO,
        pr_number: 1225,
        merged: true,
        base_ref: "main",
      }),
    ).toEqual({ repo: REPO, prNumber: 1225, baseRef: "main" });
  });

  it("ignores a PR closed without merging, which settles a line rather than advancing it", () => {
    expect(
      decideResumeFromClosedPr({ repo: REPO, pr_number: 1225, merged: false }),
    ).toEqual(null);
  });

  it("ignores an event carrying no PR number", () => {
    expect(decideResumeFromClosedPr({ repo: REPO, merged: true })).toEqual(
      null,
    );
  });

  it("ignores an event carrying no repo", () => {
    expect(decideResumeFromClosedPr({ pr_number: 1225, merged: true })).toEqual(
      null,
    );
  });

  it("ignores a pr_number that is not a number", () => {
    expect(
      decideResumeFromClosedPr({
        repo: REPO,
        pr_number: "1225",
        merged: true,
      }),
    ).toEqual(null);
  });
});
