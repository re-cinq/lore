// Spec folder card: data from /trace API; types inline (web-ui not a workspace member).
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

function CoverageNote({
  coverage,
}: {
  coverage?: { testable: number; covered: number; ratio: number };
}) {
  if (!coverage || coverage.testable === 0) {
    return null;
  }

  return (
    <p className={styles.note}>
      Coverage: {coverage.covered} / {coverage.testable} (
      {Math.round(coverage.ratio * 100)}%)
    </p>
  );
}

function FilesOrDetails({
  files,
  detailsHref,
}: {
  files?: Array<{ label: string; href: string }>;
  detailsHref?: string;
}) {
  if (files) {
    return (
      <div className={styles.files}>
        {files.map((f) => (
          <Link key={f.href} href={f.href} className={styles.fileChip}>
            {f.label}
          </Link>
        ))}
      </div>
    );
  }

  return detailsHref ? <Link href={detailsHref}>Details</Link> : null;
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
        {status && <SpecStatusPill status={status} />}
      </h3>
      {description && <p className={styles.note}>{description}</p>}
      <CoverageNote coverage={coverage} />
      <FilesOrDetails files={files} detailsHref={detailsHref} />
    </div>
  );
}
