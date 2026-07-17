// Presentational metadata header for one ADR, rendered from its parsed YAML
// frontmatter (parseFrontmatter in the container): status pill, decision date,
// domain chips, and cross-links — `relates` to the owning spec's detail page,
// `amends` to the amended ADR's detail page.
import Link from "next/link";
import SpecStatusPill from "@/components/SpecStatusPill";
import { statusInfoFromValue } from "@/lib/spec-status";

const chip: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "1px 8px",
  fontSize: "var(--fs-xs)",
  color: "var(--text-muted)",
};

const scalar = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

export default function AdrMetaView({
  owner,
  repo,
  meta,
}: {
  owner: string;
  repo: string;
  meta: Record<string, string | string[]>;
}) {
  const status = scalar(meta.status);
  const statusInfo = status ? statusInfoFromValue(status) : null;
  const date = scalar(meta.date);
  const domains = Array.isArray(meta.domains) ? meta.domains : [];
  const relates = scalar(meta.relates);
  const amends = scalar(meta.amends);
  const renderable = [statusInfo, date, relates, amends, ...domains];

  if (renderable.every((field) => !field)) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        marginBottom: 16,
      }}
    >
      {statusInfo && <SpecStatusPill info={statusInfo} />}
      {date && (
        <span className="meta" style={{ fontSize: "var(--fs-xs)" }}>
          {date}
        </span>
      )}
      {domains.map((domain) => (
        <span key={domain} style={chip}>
          {domain}
        </span>
      ))}
      {relates && (
        <span className="meta" style={{ fontSize: "var(--fs-xs)" }}>
          relates:{" "}
          <Link
            href={`/repos/${owner}/${repo}/specs/${encodeURIComponent(relates)}`}
          >
            {relates}
          </Link>
        </span>
      )}
      {amends && (
        <span className="meta" style={{ fontSize: "var(--fs-xs)" }}>
          amends:{" "}
          <Link
            href={`/repos/${owner}/${repo}/adrs/${encodeURIComponent(amends)}`}
          >
            {amends}
          </Link>
        </span>
      )}
    </div>
  );
}
