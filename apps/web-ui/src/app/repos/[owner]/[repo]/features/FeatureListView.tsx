"use client";

import Link from "next/link";
import StatusBadge from "./StatusBadge";
import styles from "./FeatureListView.module.scss";
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
      <div className={styles.header}>
        <p className={`meta ${styles.count}`}>
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
        <div className={styles.grid}>
          {features.map((f) => (
            <Link
              key={f.id}
              href={`${base}/${f.id}`}
              className={`spec-card ${styles.card}`}
            >
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>{f.title}</h3>
                <StatusBadge status={f.status} />
              </div>
              <p className={`meta ${styles.excerpt}`}>
                {f.original_prompt.slice(0, 160)}
                {f.original_prompt.length > 160 ? "…" : ""}
              </p>
              {f.parent_feature_id && (
                <p className={`meta ${styles.lineage}`}>
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
