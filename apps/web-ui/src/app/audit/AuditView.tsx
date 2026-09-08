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

/** The empty state distinguishes "nothing matches these filters" from "nothing recorded yet", so a filter that hides everything does not read as an empty audit trail. */
function AuditTable({
  entries,
  agent,
  op,
  total,
}: {
  entries: AuditViewProps["entries"];
  agent: AuditViewProps["agent"];
  op: AuditViewProps["op"];
  total: number;
}) {
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

/** Both arrows stay LINKS and are styled disabled rather than removed, so the control keeps its position between the first page and the rest. */
interface AuditPagerProps {
  pageUrl: (offset: number) => string;
  offset: number;
  pageSize: number;
  totalCount: number;
  hasPrev: boolean;
  hasNext: boolean;
}

function AuditPager(props: AuditPagerProps) {
  const { pageUrl, offset, pageSize, totalCount, hasPrev, hasNext } = props;

  return (
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
  );
}

/** Audit log view: pure render; rebuilds pagination URLs from props. */
export default function AuditView(props: AuditViewProps) {
  const { entries, totalCount, operations, agent, op } = props;
  const { offset, pageSize, hasPrev, hasNext } = props;

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
      <AuditTable entries={entries} agent={agent} op={op} total={totalCount} />
      <AuditPager
        pageUrl={pageUrl}
        offset={offset}
        pageSize={pageSize}
        totalCount={totalCount}
        hasPrev={hasPrev}
        hasNext={hasNext}
      />
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
