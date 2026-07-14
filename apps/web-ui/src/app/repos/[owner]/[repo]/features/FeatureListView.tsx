"use client";

import Link from "next/link";
import StatusBadge from "./StatusBadge";
import type { FeatureRow } from "@/lib/feature-types";

export default function FeatureListView({
  owner,
  repo,
  features,
}: {
  owner: string;
  repo: string;
  features: FeatureRow[];
}) {
  const base = `/repos/${owner}/${repo}/features`;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <p className="meta" style={{ margin: 0 }}>
          {features.length} feature{features.length === 1 ? "" : "s"} (drafts +
          shipped).
        </p>
        <Link href={`${base}/new`} className="button">
          + Feature
        </Link>
      </div>

      {features.length === 0 ? (
        <div className="spec-card">
          <p className="meta">
            No features yet. Click <strong>+ Feature</strong> to plan one from a
            prompt.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {features.map((f) => (
            <Link
              key={f.id}
              href={`${base}/${f.id}`}
              className="spec-card"
              style={{ display: "block", textDecoration: "none" }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <h3 style={{ margin: 0 }}>{f.title}</h3>
                <StatusBadge status={f.status} />
              </div>
              <p className="meta" style={{ marginTop: 6 }}>
                {f.original_prompt.slice(0, 160)}
                {f.original_prompt.length > 160 ? "…" : ""}
              </p>
              {f.parent_feature_id && (
                <p className="meta" style={{ fontSize: "var(--fs-xs)" }}>
                  ↳ split from a parent feature
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
