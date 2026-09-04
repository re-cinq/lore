import { TimeAgo } from "@/components/TimeAgo";
import { displayAgentId } from "@/lib/agent-id";
import { formatEnumLabel } from "@/lib/enum-label";
import DataTable from "@/components/DataTable";
import styles from "./EpisodesView.module.css";
import type { components } from "@/lib/api/schema";

/** One episode row; content_preview and fact_count supplied by route, not table. */
export type EpisodeRow =
  components["schemas"]["EpisodePage"]["episodes"][number];

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

/** Episode browser view; pure render with pagination from container. */
export default function EpisodesView({
  source,
  offset,
  totalCount,
  episodes,
  sources,
  pageSize,
}: EpisodesViewProps) {
  const pageUrl = (newOffset: number) => episodesUrl(source, newOffset);

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
      <DataTable
        columns={["Time", "Agent", "Source", "Ref", "Facts", "Content"]}
        rows={episodes}
        rowKey={(e) => e.id}
        empty={
          <span className={styles.emptyCell}>
            No episodes yet. Use the <code>write_episode</code> MCP tool to
            ingest text.
          </span>
        }
        cells={(e) => [
          <TimeAgo date={e.created_at} key="time" />,
          <span title={e.agent_id} key="agent">
            {displayAgentId(e.agent_id)}
          </span>,
          <span className={`op-badge op-${e.source}`} key="source">
            {formatEnumLabel(e.source)}
          </span>,
          e.ref || "—",
          e.fact_count,
          <pre className={styles.contentPre} key="content">
            {e.content_preview}
            {e.content_preview.length >= 300 ? "..." : ""}
          </pre>,
        ]}
      />
      {totalCount > pageSize && (
        <div className="pagination">
          <a
            href={pageUrl(offset - pageSize)}
            className={offset > 0 ? "" : "disabled"}
          >
            &larr; Previous
          </a>
          <span className="page-info">
            {offset + 1}&ndash;{Math.min(offset + pageSize, totalCount)} of{" "}
            {totalCount}
          </span>
          <a
            href={pageUrl(offset + pageSize)}
            className={offset + pageSize < totalCount ? "" : "disabled"}
          >
            Next &rarr;
          </a>
        </div>
      )}
    </div>
  );
}

/** The source filter carried into a page link, so paging never silently widens the view. */
function episodesUrl(
  source: string | null | undefined,
  offset: number,
): string {
  const p = new URLSearchParams();

  if (source) {
    p.set("source", source);
  }

  if (offset > 0) {
    p.set("offset", String(offset));
  }
  const qs = p.toString();

  return `/episodes${qs ? `?${qs}` : ""}`;
}
