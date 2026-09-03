// ADR metadata from frontmatter: status, date, domain chips, relates/amends cross-links.
import Link from "next/link";
import styles from "./AdrMetaView.module.scss";
import SpecStatusPill from "@/components/SpecStatusPill";
import { statusInfoFromValue } from "@/lib/spec-status";

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
    <div className={styles.header}>
      {statusInfo && <SpecStatusPill status={statusInfo} />}
      {date && <span className={`meta ${styles.field}`}>{date}</span>}
      {domains.map((domain) => (
        <span key={domain} className={styles.domain}>
          {domain}
        </span>
      ))}
      {relates && (
        <span className={`meta ${styles.field}`}>
          relates:{" "}
          <Link
            href={`/repos/${owner}/${repo}/specs/${encodeURIComponent(relates)}`}
          >
            {relates}
          </Link>
        </span>
      )}
      {amends && (
        <span className={`meta ${styles.field}`}>
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
