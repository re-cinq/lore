import type { ReactNode } from "react";
import { TimeAgo } from "@/components/TimeAgo";
import { displayAgentId } from "@/lib/agent-id";
import { formatEnumLabel } from "@/lib/enum-label";
import ScreenHeader from "@/components/ScreenHeader";
import FilterChips, { type FilterChip } from "@/components/FilterChips";
import { StatusPill } from "@/components/StatusPill";
import { sourceTone } from "./source-tone";
import styles from "./EpisodesView.module.css";
import type { components } from "@/lib/api/schema";

/** One episode row; content_preview and fact_count supplied by route, not table. */
export type EpisodeRow =
  components["schemas"]["EpisodePage"]["episodes"][number];

const LEDE =
  "Passively ingested text — conversations, reviews, observations. Facts and graph entities are extracted from each one.";

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
  /** Selectable source values for the filter chips. */
  sources: string[];
}

/** Episode browser view; pure render with pagination from container. */
export default function EpisodesView(props: EpisodesViewProps) {
  const { source, totalCount, episodes, sources } = props;
  const pageUrl = (to: number) => episodesUrl(source, to);

  return (
    <div>
      <ScreenHeader group="knowledge" title="Episodes" lede={LEDE} />
      <SourceFilter source={source} sources={sources} />
      <p className={`meta ${styles.count}`}>{totalCount} episodes</p>
      <EpisodeList episodes={episodes} />
      <EpisodePager pagination={props} pageUrl={pageUrl} />
    </div>
  );
}

/** Narrows the list to one kind of episode. Plain links, so the filter lands in the URL and a filtered view can be linked to; picking a source starts again at its first page. */
function SourceFilter({
  source,
  sources,
}: Pick<EpisodesViewProps, "source" | "sources">) {
  const chips: FilterChip[] = [
    { label: "All sources", href: "/episodes", active: !source },
    ...sources.map((s) => ({
      label: formatEnumLabel(s),
      href: episodesUrl(s, 0),
      active: source === s,
      tone: sourceTone(s),
    })),
  ];

  return <FilterChips label="Episode sources" chips={chips} />;
}

function EpisodeList({ episodes }: Pick<EpisodesViewProps, "episodes">) {
  if (episodes.length === 0) {
    return (
      <p className={styles.empty}>
        No episodes yet. Use the <code>write_episode</code> MCP tool to ingest
        text.
      </p>
    );
  }

  return (
    <ol className={styles.list} aria-label="Episodes">
      {episodes.map((e) => (
        <EpisodeCard key={e.id} episode={e} />
      ))}
    </ol>
  );
}

/** One episode. The preview gets an ellipsis at its own length limit rather than at a measured overflow — the text arrives already truncated, so the marker says "there is more", not "this did not fit". */
function EpisodeCard({ episode }: { episode: EpisodeRow }) {
  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <EpisodeOrigin episode={episode} />
        <span className={styles.when}>
          <span className={styles.facts}>{episode.fact_count} facts</span>
          <TimeAgo date={episode.created_at} inline />
        </span>
      </div>
      <pre className={styles.content}>
        {episode.content_preview}
        {episode.content_preview.length >= 300 ? "..." : ""}
      </pre>
    </li>
  );
}

/** Where the episode came from: its source, the ref it is about, and the agent. */
function EpisodeOrigin({ episode }: { episode: EpisodeRow }) {
  return (
    <span className={styles.origin}>
      <StatusPill
        label={formatEnumLabel(episode.source)}
        tone={sourceTone(episode.source)}
      />
      <span className={styles.ref}>{episode.ref || "—"}</span>
      <span className={styles.agent} title={episode.agent_id}>
        {displayAgentId(episode.agent_id)}
      </span>
    </span>
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
    <div className={styles.pager}>
      <PagerArrow href={pageUrl(offset - pageSize)} enabled={offset > 0}>
        Previous
      </PagerArrow>
      <PageRange offset={offset} pageSize={pageSize} totalCount={totalCount} />
      <PagerArrow href={pageUrl(offset + pageSize)} enabled={hasNext}>
        Next
      </PagerArrow>
    </div>
  );
}

/** One end of the pager. Stays an anchor when disabled rather than disappearing, so the control keeps its shape between the first page and the rest. */
function PagerArrow(props: {
  href: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const { href, enabled, children } = props;

  return (
    <a
      href={href}
      aria-disabled={enabled ? undefined : "true"}
      className={enabled ? styles.pageLink : `disabled ${styles.pageLink}`}
    >
      {children}
    </a>
  );
}

/** Which episodes are on screen, out of how many. One-based and clamped to the total, so the last page reads "91–97 of 97" rather than running past the end. */
function PageRange({ offset, pageSize, totalCount }: EpisodePagination) {
  return (
    <span className={styles.range}>
      {offset + 1}&ndash;{Math.min(offset + pageSize, totalCount)} of{" "}
      {totalCount}
    </span>
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
