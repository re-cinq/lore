// Resuming decomposition when a spec PR merges.
//
// This replaces `decideDecomposeKick`, which minted a `feature-decompose` task only
// for a `feature-finalize` task. Once finalize became a RESUME of the planning line
// the owning task became `feature-planning`, the predicate stopped matching, and no
// feature planned on the merged line was ever decomposed — silently.

import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { ParkedTarget } from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";
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

/** A run stamped before clones existed — the id-based fallback path. */
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
    // The join that must survive a blueprint rename — a hardcoded id is how the
    // pr_merged signal silently died (FR6.32).
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
              type: "github_action",
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
    // The same definition parks twice. Reporting a merge into the author's node
    // would tell the walk the plan was accepted.
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
    // A re-delivered webhook, or the merge-check cron seeing the same PR twice.
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

/** Records the events a resume would insert, standing in for the pool. */
function recorder() {
  const events: (ParkedTarget & { outcome: string })[] = [];
  const report = async (target: ParkedTarget, outcome: string) => {
    events.push({ ...target, outcome });
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

  it("does nothing when no open line claims the PR", async () => {
    const rec = recorder();

    await resumeDecomposition(
      { repo: REPO, prNumber: 999 },
      { assemblyRuns: new InMemoryAssemblyRuns(), report: rec.report },
    );

    expect(rec.events).toEqual([]);
  });

  it("does nothing when the PR's line is not parked on the merge", async () => {
    // An implementation line's PR merging must not report into it — it has no
    // merged node, and inventing one would advance a walk that never asked to wait.
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
    // A PR can carry a code-review line alongside the planning one; only the parked
    // merged node is a resume target.
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

// WHICH closed-PR events reach the resume at all.
//
// The resume had exactly one caller — handleMergedTask, reached only for tasks the
// mergeable sweep returns (`status IN ('pr-created','review') AND pr_number IS NOT
// NULL`). A feature-planning task is `running` and carries no PR: the push node
// stamps the LINE's args, not the task row. So no spec PR could ever reach the
// resume, on any deployment, webhook or cron. The fix is to read the merge where it
// actually arrives — the closed-PR event, which names the repo and the number that
// `findOpenByPr` matches on.
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
