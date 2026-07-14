import { TimeAgo } from "@/components/TimeAgo";
import { displayAgentId } from "@/lib/agent-id";
import { formatEnumLabel } from "@/lib/enum-label";
import styles from "./EpisodesView.module.css";

export interface EpisodeRow {
  id: string;
  agent_id: string;
  source: string;
  ref: string | null;
  content_preview: string;
  fact_count: number;
  created_at: string;
}

export interface EpisodesViewProps {
  /** The active source filter, or undefined for "All sources". */
  source?: string;
  /** Zero-based row offset of the current page. */
  offset: number;
  /** Total episode count across all pages (post-filter). */
  totalCount: number;
  /** Rows for the current page. */
  episodes: EpisodeRow[];
  /** Selectable source values for the filter dropdown. */
  sources: string[];
  /** Rows per page; drives the pagination math. */
  pageSize: number;
}

/**
 * Presentational view for the episode browser. Pure render — the container
 * (`page.tsx`) runs the queries and passes the resolved view-model down.
 */
export default function EpisodesView({
  source,
  offset,
  totalCount,
  episodes,
  sources,
  pageSize,
}: EpisodesViewProps) {
  function buildUrl(newOffset: number): string {
    const p = new URLSearchParams();

    if (source) {
      p.set("source", source);
    }

    if (newOffset > 0) {
      p.set("offset", String(newOffset));
    }
    const qs = p.toString();

    return `/episodes${qs ? `?${qs}` : ""}`;
  }

  return (
    <div>
      <h1>Episodes</h1>
      <p className={`meta ${styles.intro}`}>
        Passively ingested text blobs — conversations, reviews, observations.
        Facts and graph entities are extracted automatically.
      </p>
      <form method="get" className="filter-form">
        <select name="source" defaultValue={source || ""}>
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {formatEnumLabel(s)}
            </option>
          ))}
        </select>
        <button type="submit">Filter</button>
      </form>
      <p className={`meta ${styles.count}`}>{totalCount} episodes</p>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Agent</th>
            <th>Source</th>
            <th>Ref</th>
            <th>Facts</th>
            <th>Content</th>
          </tr>
        </thead>
        <tbody>
          {episodes.map((e) => (
            <tr key={e.id}>
              <td>
                <TimeAgo date={e.created_at} />
              </td>
              <td title={e.agent_id}>{displayAgentId(e.agent_id)}</td>
              <td>
                <span className={`op-badge op-${e.source}`}>
                  {formatEnumLabel(e.source)}
                </span>
              </td>
              <td>{e.ref || "—"}</td>
              <td>{e.fact_count}</td>
              <td>
                <pre className={styles.contentPre}>
                  {e.content_preview}
                  {e.content_preview.length >= 300 ? "..." : ""}
                </pre>
              </td>
            </tr>
          ))}
          {episodes.length === 0 && (
            <tr>
              <td colSpan={6} className={styles.emptyCell}>
                No episodes yet. Use the <code>write_episode</code> MCP tool to
                ingest text.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {totalCount > pageSize && (
        <div className="pagination">
          <a
            href={buildUrl(offset - pageSize)}
            className={offset > 0 ? "" : "disabled"}
          >
            &larr; Previous
          </a>
          <span className="page-info">
            {offset + 1}&ndash;{Math.min(offset + pageSize, totalCount)} of{" "}
            {totalCount}
          </span>
          <a
            href={buildUrl(offset + pageSize)}
            className={offset + pageSize < totalCount ? "" : "disabled"}
          >
            Next &rarr;
          </a>
        </div>
      )}
    </div>
  );
}
