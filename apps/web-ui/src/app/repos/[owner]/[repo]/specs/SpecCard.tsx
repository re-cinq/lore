// Presentational (data-down) card for one spec FOLDER on a repo list page,
// sourced from the spec-traceability graph (the source of truth) via the /trace
// API. Shows the spec's document title, description, summed coverage, and a link
// to every file in the folder. Types mirror the API JSON — web-ui is not a
// workspace member, so it cannot import @re-cinq/lore-shared.
import Link from "next/link";
import SpecStatusPill from "@/components/SpecStatusPill";
import type { SpecStatus } from "@/lib/spec-status";

export interface SpecCardProps {
  title: string;
  description: string;
  status?: SpecStatus;
  coverage?: { testable: number; covered: number; ratio: number };
  /** Multi-file spec folder: one link chip per file. */
  files?: Array<{ label: string; href: string }>;
  /** Single-file document (e.g. an ADR): a plain Details link. */
  detailsHref?: string;
}

const chip: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "2px 8px",
  fontSize: "var(--fs-xs)",
  fontFamily: "monospace",
  color: "var(--text)",
  textDecoration: "none",
};

export default function SpecCard({
  title,
  description,
  status,
  coverage,
  files,
  detailsHref,
}: SpecCardProps) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: 12,
        marginBottom: 8,
      }}
    >
      <h3
        style={{
          margin: "0 0 4px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {title}
        {status && <SpecStatusPill status={status} />}
      </h3>
      {description && (
        <p style={{ margin: "0 0 8px", color: "var(--text-muted)" }}>
          {description}
        </p>
      )}
      {coverage && coverage.testable > 0 && (
        <p style={{ margin: "0 0 8px", color: "var(--text-muted)" }}>
          Coverage: {coverage.covered} / {coverage.testable} (
          {Math.round(coverage.ratio * 100)}%)
        </p>
      )}
      {files ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {files.map((f) => (
            <Link key={f.href} href={f.href} style={chip}>
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
