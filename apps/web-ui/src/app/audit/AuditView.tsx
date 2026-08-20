import Link from "next/link";
import { TimeAgo } from "@/components/TimeAgo";
import { formatEnumLabel } from "@/lib/enum-label";
import { displayAgentId } from "@/lib/agent-id";
import { EmptyState } from "@/components/EmptyState";
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

/**
 * Presentational view for the audit log. Pure render — the container
 * (`page.tsx`) fetches rows and resolves the pagination flags; this
 * component only renders. Pagination URLs are rebuilt here from the
 * current filter values (a pure derivation of props).
 */
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
  function buildUrl(newOffset: number): string {
    const p = new URLSearchParams();

    if (agent) {
      p.set("agent", agent);
    }

    if (op) {
      p.set("op", op);
    }

    if (newOffset > 0) {
      p.set("offset", String(newOffset));
    }
    const qs = p.toString();

    return `/audit${qs ? `?${qs}` : ""}`;
  }

  const emptyState =
    agent || op || totalCount > 0 ? (
      <EmptyState
        title="No entries match these filters"
        description="Try a different agent or operation."
        action={{ href: "/audit", label: "Clear filters" }}
      />
    ) : (
      <EmptyState
        title="No activity recorded yet"
        description="Entries appear here as agents read and write memory."
      />
    );

  return (
    <div>
      <h1>Audit Trail</h1>
      <p className="meta page-lede">
        Every memory read and write across the org, in time order. Filter by
        agent or operation.
      </p>
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
      <p className={`meta ${styles.count}`}>{totalCount} total entries</p>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Agent</th>
            <th>Operation</th>
            <th>Key</th>
            <th>Pool</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>
                <TimeAgo date={e.created_at} />
              </td>
              <td title={e.agent_id}>{displayAgentId(e.agent_id)}</td>
              <td>
                <span className={`op-badge op-${e.operation}`}>
                  {formatEnumLabel(e.operation)}
                </span>
              </td>
              <td>{e.memory_key || "—"}</td>
              <td>{e.pool_name || "—"}</td>
              <td>
                {e.metadata ? (
                  <details>
                    <summary className="meta">view</summary>
                    <pre className={styles.metadata}>
                      {JSON.stringify(e.metadata, null, 2)}
                    </pre>
                  </details>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={6}>{emptyState}</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="pagination">
        <Link
          href={buildUrl(offset - pageSize)}
          className={hasPrev ? "" : "disabled"}
        >
          &larr; Previous
        </Link>
        <span className="page-info">
          {offset + 1}&ndash;{Math.min(offset + pageSize, totalCount)} of{" "}
          {totalCount}
        </span>
        <Link
          href={buildUrl(offset + pageSize)}
          className={hasNext ? "" : "disabled"}
        >
          Next &rarr;
        </Link>
      </div>
    </div>
  );
}
