import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { InsightsHeading } from "@/components/insights/InsightsHeading";
import { AuditFilters } from "./AuditFilters";
import { AuditRow } from "./AuditRow";
import { auditUrl } from "./audit-url";
import styles from "./AuditView.module.css";
import type { components } from "@/lib/api/schema";

/** One `memory.audit_log` entry, as `/api/memory-audit` publishes it. */
export type AuditEntryRow =
  components["schemas"]["MemoryAuditPage"]["entries"][number];

export interface AuditPagination {
  /** Zero-based offset of the first row on this page. */
  offset: number;
  /** Page size, used to compute the previous/next offsets and the displayed range. */
  pageSize: number;
  totalCount: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export interface AuditViewProps extends AuditPagination {
  entries: AuditEntryRow[];
  operations: string[];
  /** Current filter values, used as form defaults and to preserve filters in pagination URLs. */
  agent?: string;
  op?: string;
}

/** Audit log view: pure render; rebuilds pagination URLs from props. */
export default function AuditView(props: AuditViewProps) {
  const { entries, totalCount, operations, agent, op } = props;
  const pageUrl = (to: number) => auditUrl({ agent, op, offset: to });

  return (
    <div>
      <InsightsHeading
        title="Audit trail"
        lede="Every memory read and write across the org, newest first."
      />
      <AuditFilters agent={agent} op={op} operations={operations} />
      <p className={`meta ${styles.count}`}>{totalCount} total entries</p>
      <AuditLog
        entries={entries}
        filtered={!!(agent || op || totalCount > 0)}
      />
      <AuditPager pageUrl={pageUrl} pagination={props} />
    </div>
  );
}

/** The empty state distinguishes "nothing matches these filters" from "nothing recorded yet", so a filter that hides everything does not read as an empty audit trail. */
interface AuditLogProps {
  entries: AuditEntryRow[];
  filtered: boolean;
}

function AuditLog({ entries, filtered }: AuditLogProps) {
  return (
    <section className={styles.log} aria-label="Audit entries">
      {entries.length === 0 ? (
        <AuditEmptyState filtered={filtered} />
      ) : (
        <ul className={styles.rows}>
          {entries.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** An empty page under a filter is a different story from an empty trail, and only the first one has an action. */
function AuditEmptyState({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return (
      <EmptyState
        title="No entries match these filters"
        description="Try a different agent or operation."
        action={{ href: "/audit", label: "Clear filters" }}
      />
    );
  }

  return (
    <EmptyState
      title="No activity recorded yet"
      description="Entries appear here as agents read and write memory."
    />
  );
}

interface AuditPagerProps {
  pageUrl: (offset: number) => string;
  pagination: AuditPagination;
}

function AuditPager({ pageUrl, pagination }: AuditPagerProps) {
  const { offset, pageSize, totalCount, hasPrev, hasNext } = pagination;

  return (
    <div className={`pagination ${styles.pager}`}>
      <PagerLink href={pageUrl(offset - pageSize)} enabled={hasPrev}>
        Previous
      </PagerLink>
      <span className="page-info">
        {offset + 1}&ndash;{Math.min(offset + pageSize, totalCount)} of{" "}
        {totalCount}
      </span>
      <PagerLink href={pageUrl(offset + pageSize)} enabled={hasNext}>
        Next
      </PagerLink>
    </div>
  );
}

interface PagerLinkProps {
  href: string;
  enabled: boolean;
  children: ReactNode;
}

/** Both arrows stay LINKS and are styled disabled rather than removed, so the control keeps its position between the first page and the rest. */
function PagerLink({ href, enabled, children }: PagerLinkProps) {
  return (
    <Link
      href={href}
      className={`${styles.pagerLink} ${enabled ? "" : "disabled"}`}
      aria-disabled={enabled ? undefined : true}
    >
      {children}
    </Link>
  );
}
