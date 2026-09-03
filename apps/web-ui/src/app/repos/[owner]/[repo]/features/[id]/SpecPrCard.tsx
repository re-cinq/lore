"use client";

import { Alert } from "@/components/Alert";
import type { FeatureRow } from "@/lib/feature-types";

// Spec PR open, line parked on `merged` wait node; author needs to know machine waits on PERSON.
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
