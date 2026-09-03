"use client";

import { Alert } from "@/components/Alert";
import { TimeAgo } from "@/components/TimeAgo";

// decompose/issues agents fail differently; naming which is working matters for troubleshooting.
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
      <Alert>The filed stories and tasks appear here when it finishes.</Alert>
    </div>
  );
}
