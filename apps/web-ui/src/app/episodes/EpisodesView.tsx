import { TimeAgo } from "@/components/TimeAgo";
import { displayAgentId } from "@/lib/agent-id";
import { formatEnumLabel } from "@/lib/enum-label";
import DataTable from "@/components/DataTable";
import styles from "./EpisodesView.module.css";
import type { components } from "@/lib/api/schema";

/** One episode row; content_preview and fact_count supplied by route, not table. */
export type EpisodeRow =
  components["schemas"]["EpisodePage"]["episodes"][number];

export interface EpisodePagination {
  /** Zero-based row offset of the current page. */
  offset: number;
  /** Total episode count across all pages (post-filter). */
  totalCount: number;
  /** Rows per page; drives the pagination math. */
  pageSize: number;
}

export interface EpisodesViewProps extends EpisodePagination {
  /** The active source filter, or undefined for "All sources". */
  source?: string;
  /** Rows for the current page. */
  episodes: EpisodeRow[];
  /** Selectable source values for the filter dropdown. */
  sources: string[];
}

/** One episode as a row. The preview gets an ellipsis at its own length limit rather than at a measured overflow — the text arrives already truncated, so the marker says "there is more", not "this did not fit". */
function episodeCells(episode: EpisodesViewProps["episodes"][number]) {
  return [
    <TimeAgo date={episode.created_at} key="time" />,
    <span title={episode.agent_id} key="agent">
      {displayAgentId(episode.agent_id)}
    </span>,
    <span className={`op-badge op-${episode.source}`} key="source">
      {formatEnumLabel(episode.source)}
    </span>,
    episode.ref || "—",
    episode.fact_count,
    <pre className={styles.contentPre} key="content">
      {episode.content_preview}
      {episode.content_preview.length >= 300 ? "..." : ""}
    </pre>,
  ];
}

function EpisodeTable({
  episodes,
}: {
  episodes: EpisodesViewProps["episodes"];
}) {
  return (
    <DataTable
      columns={["Time", "Agent", "Source", "Ref", "Facts", "Content"]}
      rows={episodes}
      rowKey={(e) => e.id}
      empty={
        <span className={styles.emptyCell}>
          No episodes yet. Use the <code>write_episode</code> MCP tool to ingest
          text.
        </span>
      }
      cells={episodeCells}
    />
  );
}

/** Which episodes are on screen, out of how many. One-based and clamped to the total, so the last page reads "91–97 of 97" rather than running past the end. */
function PageRange({ offset, pageSize, totalCount }: EpisodePagination) {
  return (
    <span className="page-info">
      {offset + 1}&ndash;{Math.min(offset + pageSize, totalCount)} of{" "}
      {totalCount}
    </span>
  );
}

/** One end of the pager. Stays an anchor when disabled rather than disappearing, so the control keeps its shape between the first page and the rest. */
function PagerArrow({
  href,
  enabled,
  children,
}: {
  href: string;
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <a href={href} className={enabled ? "" : "disabled"}>
      {children}
    </a>
  );
}

interface EpisodePagerProps {
  pagination: EpisodePagination;
  pageUrl: (offset: number) => string;
}

/** Both arrows stay ANCHORS and are styled disabled rather than removed, so the control keeps its position between the first page and the rest. */
function EpisodePager({ pagination, pageUrl }: EpisodePagerProps) {
  const { offset, pageSize, totalCount } = pagination;

  if (totalCount <= pageSize) {
    return null;
  }
  const hasNext = offset + pageSize < totalCount;

  return (
    <div className="pagination">
      <PagerArrow href={pageUrl(offset - pageSize)} enabled={offset > 0}>
        &larr; Previous
      </PagerArrow>
      <PageRange offset={offset} pageSize={pageSize} totalCount={totalCount} />
      <PagerArrow href={pageUrl(offset + pageSize)} enabled={hasNext}>
        Next &rarr;
      </PagerArrow>
    </div>
  );
}

/** Narrows the list to one kind of episode. A plain GET form, so the filter lands in the URL and a filtered view can be linked to. */
function SourceFilter({
  source,
  sources,
}: Pick<EpisodesViewProps, "source" | "sources">) {
  return (
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
  );
}

/** Episode browser view; pure render with pagination from container. */
export default function EpisodesView(props: EpisodesViewProps) {
  const { source, totalCount, episodes, sources } = props;
  const pageUrl = (to: number) => episodesUrl(source, to);

  return (
    <div>
      <h1>Episodes</h1>
      <p className={`meta ${styles.intro}`}>
        Passively ingested text blobs — conversations, reviews, observations.
        Facts and graph entities are extracted automatically.
      </p>
      <SourceFilter source={source} sources={sources} />
      <p className={`meta ${styles.count}`}>{totalCount} episodes</p>
      <EpisodeTable episodes={episodes} />
      <EpisodePager pagination={props} pageUrl={pageUrl} />
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
