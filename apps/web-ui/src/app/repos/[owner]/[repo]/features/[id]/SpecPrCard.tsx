"use client";

import { Alert } from "@/components/Alert";
import type { FeatureRow } from "@/lib/feature-types";

// The spec PR is open and the line is parked on its `merged` wait node.
//
// Before the lifecycle became one line this state was invisible: the wizard
// vanished and the finalized view said "Creating the spec PR…" indefinitely. The
// author needs to know the machine is waiting on a PERSON, and that nothing else
// is required of them once it merges.
export default function SpecPrCard({ feature }: { feature: FeatureRow }) {
  return (
    <div className="spec-card" role="status">
      <h3>Waiting for the spec PR</h3>
      {feature.spec_pr_url ? (
        <p>
          <a href={feature.spec_pr_url} target="_blank" rel="noreferrer">
            #{feature.spec_pr_number}
          </a>
          {feature.spec_path ? ` — ${feature.spec_path}` : ""}
        </p>
      ) : (
        <Alert>The branch is pushed; the PR link is on its way.</Alert>
      )}
      <p className="meta">
        Review and merge it when you are ready. Decomposition into user stories
        and tasks starts automatically on merge — you do not need to come back
        here.
      </p>
    </div>
  );
}
