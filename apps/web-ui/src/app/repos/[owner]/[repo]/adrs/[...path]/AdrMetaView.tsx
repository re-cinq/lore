// ADR metadata from frontmatter: status, date, domain chips, relates/amends cross-links.
import Link from "next/link";
import styles from "./AdrMetaView.module.scss";
import SpecStatusPill from "@/components/SpecStatusPill";
import { statusInfoFromValue } from "@/lib/spec-status";

const scalar = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

function resolveStatusInfo(status: string | undefined) {
  return status ? statusInfoFromValue(status) : null;
}

function domainsOf(meta: Record<string, string | string[]>): string[] {
  return Array.isArray(meta.domains) ? meta.domains : [];
}

/** Every field absent. Takes `unknown` because it only asks whether a value is there, and the status field is a resolved object rather than a string. */
function isEmptyMeta(fields: readonly unknown[]): boolean {
  return fields.every((field) => !field);
}

function CrossLinkField({
  label,
  href,
  value,
}: {
  label: string;
  href: string;
  value: string | undefined;
}) {
  if (!value) {
    return null;
  }

  return (
    <span className={`meta ${styles.field}`}>
      {label}: <Link href={href}>{value}</Link>
    </span>
  );
}

export default function AdrMetaView({
  owner,
  repo,
  meta,
}: {
  owner: string;
  repo: string;
  meta: Record<string, string | string[]>;
}) {
  const statusInfo = resolveStatusInfo(scalar(meta.status));
  const date = scalar(meta.date);
  const domains = domainsOf(meta);
  const relates = scalar(meta.relates);
  const amends = scalar(meta.amends);

  if (isEmptyMeta([statusInfo, date, relates, amends, ...domains])) {
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
      <CrossLinkField
        label="relates"
        value={relates}
        href={`/repos/${owner}/${repo}/specs/${encodeURIComponent(relates ?? "")}`}
      />
      <CrossLinkField
        label="amends"
        value={amends}
        href={`/repos/${owner}/${repo}/adrs/${encodeURIComponent(amends ?? "")}`}
      />
    </div>
  );
}
