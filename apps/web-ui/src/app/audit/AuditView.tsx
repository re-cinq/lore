import Link from "next/link";
import type { ReactNode } from "react";
import { TimeAgo } from "@/components/TimeAgo";
import { formatEnumLabel } from "@/lib/enum-label";
import { displayAgentId } from "@/lib/agent-id";
import { EmptyState } from "@/components/EmptyState";
import DataTable from "@/components/DataTable";
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

/** One audit entry as a row. The agent's full id is in the title attribute — the displayed form is shortened, and the full id is what someone needs when tracing an operation back. */
function auditCells(entry: AuditViewProps["entries"][number]) {
  return [
    <TimeAgo date={entry.created_at} key="time" />,
    <span title={entry.agent_id} key="agent">
      {displayAgentId(entry.agent_id)}
    </span>,
    <span className={`op-badge op-${entry.operation}`} key="op">
      {formatEnumLabel(entry.operation)}
    </span>,
    entry.memory_key || "—",
    entry.pool_name || "—",
    entry.metadata ? (
      <MetadataDetails metadata={entry.metadata} key="meta" />
    ) : (
      "—"
    ),
  ];
}

interface AuditTableProps {
  entries: AuditViewProps["entries"];
  agent: AuditViewProps["agent"];
  op: AuditViewProps["op"];
  total: number;
}

/** The empty state distinguishes "nothing matches these filters" from "nothing recorded yet", so a filter that hides everything does not read as an empty audit trail. */
function AuditTable({ entries, agent, op, total }: AuditTableProps) {
  return (
    <DataTable
      columns={["Time", "Agent", "Operation", "Key", "Pool", "Details"]}
      rows={entries}
      rowKey={(e) => e.id}
      empty={<AuditEmptyState filtered={!!(agent || op || total > 0)} />}
      cells={auditCells}
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
    <div className="pagination">
      <PagerLink href={pageUrl(offset - pageSize)} enabled={hasPrev}>
        &larr; Previous
      </PagerLink>
      <span className="page-info">
        {offset + 1}&ndash;{Math.min(offset + pageSize, totalCount)} of{" "}
        {totalCount}
      </span>
      <PagerLink href={pageUrl(offset + pageSize)} enabled={hasNext}>
        Next &rarr;
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
    <Link href={href} className={enabled ? "" : "disabled"}>
      {children}
    </Link>
  );
}

/** Audit log view: pure render; rebuilds pagination URLs from props. */
export default function AuditView(props: AuditViewProps) {
  const { entries, totalCount, operations, agent, op } = props;
  const pageUrl = (to: number) => auditUrl({ agent, op, offset: to });

  return (
    <div>
      <h1>Audit Trail</h1>
      <p className="meta page-lede">
        Every memory read and write across the org, in time order. Filter by
        agent or operation.
      </p>
      <AuditFilters agent={agent} op={op} operations={operations} />
      <p className={`meta ${styles.count}`}>{totalCount} total entries</p>
      <AuditTable entries={entries} agent={agent} op={op} total={totalCount} />
      <AuditPager pageUrl={pageUrl} pagination={props} />
    </div>
  );
}

interface AuditUrlParams {
  agent?: string | null;
  op?: string | null;
  offset: number;
}

/** The current filters carried into a page link, so paging never silently widens the view. */
function auditUrl({ agent, op, offset }: AuditUrlParams): string {
  const p = new URLSearchParams();

  if (agent) {
    p.set("agent", agent);
  }

  if (op) {
    p.set("op", op);
  }

  if (offset > 0) {
    p.set("offset", String(offset));
  }
  const qs = p.toString();

  return `/audit${qs ? `?${qs}` : ""}`;
}

interface AuditFiltersProps {
  agent?: string | null;
  op?: string | null;
  operations: string[];
}

function AuditFilters({ agent, op, operations }: AuditFiltersProps) {
  return (
    <form method="get" className="filter-form">
      <input
        type="text"
        name="agent"
        defaultValue={agent || ""}
        placeholder="Filter by agent ID..."
      />
      <OperationSelect op={op} operations={operations} />
      <button type="submit">Filter</button>
    </form>
  );
}

function OperationSelect({ op, operations }: Omit<AuditFiltersProps, "agent">) {
  return (
    <select name="op" defaultValue={op || ""}>
      <option value="">All operations</option>
      {operations.map((o) => (
        <option key={o} value={o}>
          {formatEnumLabel(o)}
        </option>
      ))}
    </select>
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

function MetadataDetails({ metadata }: { metadata: unknown }) {
  return (
    <details>
      <summary className="meta">view</summary>
      <pre className={styles.metadata}>{JSON.stringify(metadata, null, 2)}</pre>
    </details>
  );
}
