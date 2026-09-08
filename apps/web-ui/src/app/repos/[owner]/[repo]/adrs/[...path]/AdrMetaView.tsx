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

/** The five frontmatter fields this header renders. Everything else in the frontmatter is left alone — an ADR may carry keys this view has no opinion about. */
function metaFields(meta: Record<string, string | string[]>) {
  return {
    statusInfo: resolveStatusInfo(scalar(meta.status)),
    date: scalar(meta.date),
    domains: domainsOf(meta),
    relates: scalar(meta.relates),
    amends: scalar(meta.amends),
  };
}

/** The documents this ADR points at. `relates` names a spec and `amends` another ADR, so the two go to different routes. */
function CrossLinks({
  owner,
  repo,
  relates,
  amends,
}: {
  owner: string;
  repo: string;
  relates: string | undefined;
  amends: string | undefined;
}) {
  return (
    <>
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
    </>
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
  const { statusInfo, date, domains, relates, amends } = metaFields(meta);

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
      <CrossLinks owner={owner} repo={repo} relates={relates} amends={amends} />
    </div>
  );
}
