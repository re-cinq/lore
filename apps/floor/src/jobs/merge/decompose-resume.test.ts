// Resuming decomposition when a spec PR merges.
//
// This replaces `decideDecomposeKick`, which minted a `feature-decompose` task only
// for a `feature-finalize` task. Once finalize became a RESUME of the planning line
// the owning task became `feature-planning`, the predicate stopped matching, and no
// feature planned on the merged line was ever decomposed — silently.

import { describe, it, expect } from "vitest";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import type { ParkedTarget } from "@re-cinq/lore-shared/project/assembly-lines/parked-node.js";
import { decideMergeResume, resumeDecomposition } from "./decompose-resume.js";

const REPO = "re-cinq/lore";

const node = (nodeId: string, iteration: number, outcome: string | null) => ({
  nodeId,
  iteration,
  outcome,
});

describe("decideMergeResume", () => {
  it("targets the merged node a pushed line is parked on", () => {
    expect(
      decideMergeResume("line-1", "running", [
        node("push", 1, "success"),
        node("merged", 1, null),
      ]),
    ).toEqual({ lineId: "line-1", nodeId: "merged", iteration: 1 });
  });

  it("ignores a line parked on the author rather than the merge", () => {
    // The same definition parks twice. Reporting a merge into the author's node
    // would tell the walk the plan was accepted.
    expect(
      decideMergeResume("line-1", "running", [node("author", 2, null)]),
    ).toBeNull();
  });

  it("ignores a merged node that already reported", () => {
    // A re-delivered webhook, or the merge-check cron seeing the same PR twice.
    expect(
      decideMergeResume("line-1", "running", [node("merged", 1, "success")]),
    ).toBeNull();
  });

  it("ignores a line that is no longer open", () => {
    expect(
      decideMergeResume("line-1", "finished", [node("merged", 1, null)]),
    ).toBeNull();
  });
});

/** Records the events a resume would insert, standing in for the pool. */
function recorder() {
  const events: (ParkedTarget & { outcome: string })[] = [];
  const report = async (target: ParkedTarget, outcome: string) => {
    events.push({ ...target, outcome });
  };

  return { events, report };
}

async function lineParkedOnMerge(prNumber: number) {
  const lines = new InMemoryAssemblyLines();
  const id = await lines.start({
    definitionName: "feature-planning",
    repo: REPO,
    branch: "feature/x",
    args: { pr_number: prNumber, feature_id: "feat-1" },
  });

  await lines.markRunning(id);
  await lines.ensureNodeStart({
    assemblyLineId: id,
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
      { assemblyLines: lines, report: rec.report },
    );

    expect(rec.events).toEqual([
      { lineId: id, nodeId: "merged", iteration: 1, outcome: "success" },
    ]);
  });

  it("does nothing when no open line claims the PR", async () => {
    const rec = recorder();

    await resumeDecomposition(
      { repo: REPO, prNumber: 999 },
      { assemblyLines: new InMemoryAssemblyLines(), report: rec.report },
    );

    expect(rec.events).toEqual([]);
  });

  it("does nothing when the PR's line is not parked on the merge", async () => {
    // An implementation line's PR merging must not report into it — it has no
    // merged node, and inventing one would advance a walk that never asked to wait.
    const lines = new InMemoryAssemblyLines();
    const id = await lines.start({
      definitionName: "implementation",
      repo: REPO,
      branch: "feature/y",
      args: { pr_number: 7 },
    });

    await lines.markRunning(id);
    await lines.ensureNodeStart({
      assemblyLineId: id,
      nodeId: "review",
      iteration: 1,
    });
    const rec = recorder();

    await resumeDecomposition(
      { repo: REPO, prNumber: 7 },
      { assemblyLines: lines, report: rec.report },
    );

    expect(rec.events).toEqual([]);
  });

  it("reports once even when the PR has several open lines", async () => {
    // A PR can carry a code-review line alongside the planning one; only the parked
    // merged node is a resume target.
    const { lines, id } = await lineParkedOnMerge(42);
    const reviewId = await lines.start({
      definitionName: "code-review",
      repo: REPO,
      branch: "feature/x",
      args: { pr_number: 42 },
    });

    await lines.markRunning(reviewId);
    const rec = recorder();

    await resumeDecomposition(
      { repo: REPO, prNumber: 42 },
      { assemblyLines: lines, report: rec.report },
    );

    expect(rec.events).toEqual([
      { lineId: id, nodeId: "merged", iteration: 1, outcome: "success" },
    ]);
  });
});
