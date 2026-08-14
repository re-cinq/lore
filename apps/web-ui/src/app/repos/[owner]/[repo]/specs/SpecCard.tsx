// Presentational (data-down) card for one spec FOLDER on a repo list page,
// sourced from the spec-traceability graph (the source of truth) via the /trace
// API. Shows the spec's document title, description, spec.md's own coverage, and
// a link to every file in the folder. Types mirror the API JSON — web-ui is not a
// workspace member, so it cannot import @re-cinq/lore-shared.
import Link from "next/link";
import styles from "./SpecCard.module.scss";
import SpecStatusPill from "@/components/SpecStatusPill";
import type { SpecStatusInfo } from "@/lib/spec-status";

export interface SpecCardProps {
  title: string;
  description: string;
  status?: SpecStatusInfo;
  coverage?: { testable: number; covered: number; ratio: number };
  /** Multi-file spec folder: one link chip per file. */
  files?: Array<{ label: string; href: string }>;
  /** Single-file document (e.g. an ADR): a plain Details link. */
  detailsHref?: string;
}

export default function SpecCard({
  title,
  description,
  status,
  coverage,
  files,
  detailsHref,
}: SpecCardProps) {
  return (
    <div className={styles.card}>
      <h3 className={styles.title}>
        {title}
        {status && <SpecStatusPill info={status} />}
      </h3>
      {description && <p className={styles.note}>{description}</p>}
      {coverage && coverage.testable > 0 && (
        <p className={styles.note}>
          Coverage: {coverage.covered} / {coverage.testable} (
          {Math.round(coverage.ratio * 100)}%)
        </p>
      )}
      {files ? (
        <div className={styles.files}>
          {files.map((f) => (
            <Link key={f.href} href={f.href} className={styles.fileChip}>
              {f.label}
            </Link>
          ))}
        </div>
      ) : (
        detailsHref && <Link href={detailsHref}>Details</Link>
      )}
    </div>
  );
}
