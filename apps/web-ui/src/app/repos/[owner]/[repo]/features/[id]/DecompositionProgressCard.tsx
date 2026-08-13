"use client";

import { TimeAgo } from "@/components/TimeAgo";

// The spec PR merged and the line resumed: the `decompose` agent is breaking the
// spec into user stories and tasks, or the `issues` station is filing them.
//
// Naming WHICH is working matters — they fail for different reasons. A decompose
// that cannot break down a thin spec is a question for the author; an issues
// station that rejects a label the repo does not have sends the artifact back for
// one correction.
const WORKING: Record<string, string> = {
  decompose: "Breaking the spec into user stories and tasks",
  issues: "Filing the Issues and spec-tasks on GitHub",
};

export default function DecompositionProgressCard({
  nodeId,
  since,
  iteration,
}: {
  nodeId: string;
  since?: string;
  iteration?: number;
}) {
  return (
    <div className="spec-card" role="status">
      <h3>{WORKING[nodeId] ?? "Decomposing the spec"}</h3>
      <p className="meta">
        {since ? <TimeAgo date={since} inline /> : "just started"}
        {iteration && iteration > 1
          ? ` · attempt ${iteration} — the previous decomposition was sent back for a correction`
          : ""}
      </p>
      <p className="meta">
        The filed stories and tasks appear here when it finishes.
      </p>
    </div>
  );
}
