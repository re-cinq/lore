import Link from "next/link";
import styles from "./AuditView.module.css";

export interface AuditEntryRow {
  id: string;
  agent_id: string;
  operation: string;
  memory_key: string | null;
  pool_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

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

  return (
    <div>
      <h1>Audit Trail</h1>
      <p className="meta" style={{ marginBottom: 16 }}>
        Every memory read and write across the org, in time order. Filter by agent or operation.
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
              {o}
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
              <td>{new Date(e.created_at).toLocaleString()}</td>
              <td title={e.agent_id}>{e.agent_id.substring(0, 8)}...</td>
              <td>
                <span className={`op-badge op-${e.operation}`}>
                  {e.operation}
                </span>
              </td>
              <td>{e.memory_key || "—"}</td>
              <td>{e.pool_name || "—"}</td>
              <td>
                {e.metadata ? JSON.stringify(e.metadata).substring(0, 50) : "—"}
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={6} className={styles.emptyCell}>
                No audit entries found
              </td>
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
