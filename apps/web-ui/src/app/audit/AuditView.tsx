import Link from "next/link";
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

export interface AuditViewProps {
  entries: AuditEntryRow[];
  totalCount: number;
  operations: string[];
  /** Current filter values, used as form defaults and to preserve filters in pagination URLs. */
  agent?: string;
  op?: string;
  /** Zero-based offset of the first row on this page. */
  offset: number;
  /** Page size, used to compute the previous/next offsets and the displayed range. */
  pageSize: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/** Audit log view: pure render; rebuilds pagination URLs from props. */
export default function AuditView({
  entries,
  totalCount,
  operations,
  agent,
  op,
  offset,
  pageSize,
  hasPrev,
  hasNext,
}: AuditViewProps) {
  const pageUrl = (newOffset: number) =>
    auditUrl({ agent, op, offset: newOffset });

  return (
    <div>
      <h1>Audit Trail</h1>
      <p className="meta page-lede">
        Every memory read and write across the org, in time order. Filter by
        agent or operation.
      </p>
      <AuditFilters agent={agent} op={op} operations={operations} />
      <p className={`meta ${styles.count}`}>{totalCount} total entries</p>
      <DataTable
        columns={["Time", "Agent", "Operation", "Key", "Pool", "Details"]}
        rows={entries}
        rowKey={(e) => e.id}
        empty={<AuditEmptyState filtered={!!(agent || op || totalCount > 0)} />}
        cells={(e) => [
          <TimeAgo date={e.created_at} key="time" />,
          <span title={e.agent_id} key="agent">
            {displayAgentId(e.agent_id)}
          </span>,
          <span className={`op-badge op-${e.operation}`} key="op">
            {formatEnumLabel(e.operation)}
          </span>,
          e.memory_key || "—",
          e.pool_name || "—",
          e.metadata ? (
            <MetadataDetails metadata={e.metadata} key="meta" />
          ) : (
            "—"
          ),
        ]}
      />
      <div className="pagination">
        <Link
          href={pageUrl(offset - pageSize)}
          className={hasPrev ? "" : "disabled"}
        >
          &larr; Previous
        </Link>
        <span className="page-info">
          {offset + 1}&ndash;{Math.min(offset + pageSize, totalCount)} of{" "}
          {totalCount}
        </span>
        <Link
          href={pageUrl(offset + pageSize)}
          className={hasNext ? "" : "disabled"}
        >
          Next &rarr;
        </Link>
      </div>
    </div>
  );
}

/** The current filters carried into a page link, so paging never silently widens the view. */
function auditUrl({
  agent,
  op,
  offset,
}: {
  agent?: string | null;
  op?: string | null;
  offset: number;
}): string {
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

function AuditFilters({
  agent,
  op,
  operations,
}: {
  agent?: string | null;
  op?: string | null;
  operations: string[];
}) {
  return (
    <form method="get" className="filter-form">
      <input
        type="text"
        name="agent"
        defaultValue={agent || ""}
        placeholder="Filter by agent ID..."
      />
      <select name="op" defaultValue={op || ""}>
        <option value="">All operations</option>
        {operations.map((o) => (
          <option key={o} value={o}>
            {formatEnumLabel(o)}
          </option>
        ))}
      </select>
      <button type="submit">Filter</button>
    </form>
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
