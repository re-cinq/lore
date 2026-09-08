"use client";

import { Alert } from "@/components/Alert";
import Link from "next/link";
import StatusBadge from "./StatusBadge";
import styles from "./FeatureListView.module.scss";
import type { FeatureRow } from "@/lib/feature-types";

/** The features, or an invitation to plan one. The empty state names the control by its label so a first-time reader knows where to start. */
function FeatureGrid({
  features,
  base,
}: {
  features: FeatureRow[];
  base: string;
}) {
  if (features.length === 0) {
    return (
      <div className="spec-card">
        <Alert variant="secondary">
          No features yet. Click <strong>+ Feature</strong> to plan one from a
          prompt.
        </Alert>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {features.map((feature) => (
        <FeatureCard key={feature.id} feature={feature} base={base} />
      ))}
    </div>
  );
}

/** One feature, as much of it as fits on a card. The prompt is excerpted rather than wrapped: the grid only works if every card is roughly the same height, and a feature's title is what the reader scans for. */
function FeatureCard({ feature, base }: { feature: FeatureRow; base: string }) {
  return (
    <Link href={`${base}/${feature.id}`} className={`spec-card ${styles.card}`}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{feature.title}</h3>
        <StatusBadge status={feature.status} />
      </div>
      <p className={`meta ${styles.excerpt}`}>
        {feature.original_prompt.slice(0, 160)}
        {feature.original_prompt.length > 160 ? "…" : ""}
      </p>
      {feature.parent_feature_id && (
        <p className={`meta ${styles.lineage}`}>
          ↳ split from a parent feature
        </p>
      )}
    </Link>
  );
}

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

      <FeatureGrid features={features} base={base} />
    </div>
  );
}
