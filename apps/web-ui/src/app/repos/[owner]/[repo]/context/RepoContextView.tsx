import { Alert } from "@/components/Alert";
import HelpPopover from "@/components/HelpPopover";
import ContextFilters from "./ContextFilters";
import ContextCard from "./ContextCard";
import LoadMore from "./LoadMore";
import { CONTEXT_PAGE_SIZE } from "./pagination";
import { type ChunkMeta } from "@/lib/chunk-presenter";
import styles from "./RepoContextView.module.css";
import type { components } from "@/lib/api/schema";

/** The five chunk fields this view renders, typed by the contract. */
export type RepoContextChunk = Pick<
  components["schemas"]["ChunkList"]["chunks"][number],
  "id" | "file_path" | "content_type" | "content" | "ingested_at"
> & { metadata: ChunkMeta | null };

export interface RepoContextViewProps {
  owner: string;
  repo: string;
  /** Active content_type filter, or undefined for "All". */
  type?: string;
  /** Active keyword query, or undefined. */
  q?: string;
  /** Distinct content_types present in this repo (drives the filter chips). */
  types: string[];
  chunks: RepoContextChunk[];
  /** Whether more chunks exist beyond the first server-rendered page. */
  hasMore?: boolean;
}

function emptyMessage(q?: string, type?: string): string {
  if (q) {
    return `No context matches “${q}”${type ? ` in ${type}` : ""}.`;
  }

  if (type) {
    return `No ${type} context ingested yet.`;
  }

  return "No context ingested yet. Context will appear after the nightly ingestion runs.";
}

/** What context is and how an agent gets it. Answers the three questions a reader arrives with — what is in here, how fresh is it, and what an agent actually sees of it. */
function ContextHelp() {
  return (
    <HelpPopover label="How context is used">
      <p>
        Context is everything Lore has ingested about this repo — conventions,
        ADRs, specs, and code — stored as embedded chunks.
      </p>
      <ul>
        <li>
          Agents load it on turn 1 of every task via{" "}
          <code>assemble_context</code>, and search it with{" "}
          <code>search_context</code>.
        </li>
        <li>
          It is refreshed by nightly ingestion; a repo not ingested in over 7
          days is flagged <strong>stale</strong>.
        </li>
        <li>
          Higher-signal chunks (incidents, conflicts, recent facts) are surfaced
          first within the token budget.
        </li>
      </ul>
    </HelpPopover>
  );
}

/** What context IS, for a reader who has not met the term. Kept beside the list rather than in a doc, because the question arises exactly here. */
function ContextHeader() {
  return (
    <>
      <div className={styles.header}>
        <h2 className={styles.title}>Context</h2>
        <ContextHelp />
      </div>
      <p className={`meta ${styles.intro}`}>
        Conventions, ADRs, specs, and code ingested from this repo that agents
        use as context.
      </p>
    </>
  );
}

/** How many chunks are on screen. Says "showing first N" when the list is truncated, because a plain count would read as the total and make the repo look smaller than it is. */
function ChunkCount({
  count,
  q,
  more,
}: {
  count: number;
  q: string | undefined;
  more: boolean;
}) {
  return (
    <p className="meta">
      {more ? `showing first ${count}` : `${count}`} chunk
      {count === 1 ? "" : "s"}
      {q ? ` matching “${q}”` : ""}
    </p>
  );
}

/** The chunks and the way to ask for more. A chunk with no `file_path` came from a source with no file behind it — a memory or a fact — so it gets no detail link rather than one that would 404. */
function ChunkList({ base, fullName, ...props }: ChunkListProps) {
  return (
    <>
      {props.chunks.map((chunk) => (
        <ContextCard
          key={chunk.id}
          chunk={chunk}
          repo={fullName}
          detailHref={detailHrefOf(chunk, base)}
        />
      ))}
      <LoadMore {...props} initialOffset={CONTEXT_PAGE_SIZE} />
    </>
  );
}

type ChunkListProps = Pick<
  RepoContextViewProps,
  "chunks" | "owner" | "repo" | "q" | "type"
> & { base: string; fullName: string; hasMore: boolean };

/** The chunk's own page, or nothing. A chunk with no `file_path` came from a source with no file behind it — a memory or a fact — so it gets no link rather than one that would 404. */
function detailHrefOf(
  chunk: RepoContextViewProps["chunks"][number],
  base: string,
): string | undefined {
  return chunk.file_path
    ? `${base}/${encodeURIComponent(chunk.file_path)}`
    : undefined;
}

/** Presentational view for repo's ingested context; container runs queries and hands view-model down. */
export default function RepoContextView(props: RepoContextViewProps) {
  const { owner, repo, type, q, chunks, hasMore = false } = props;
  const base = `/repos/${owner}/${repo}/context`;

  return (
    <div>
      <ContextHeader />

      <ContextFilters
        basePath={base}
        types={props.types}
        activeType={type}
        q={q}
      />

      <ChunkCount count={chunks.length} q={q} more={hasMore} />

      {chunks.length === 0 ? (
        <Alert variant="secondary">{emptyMessage(q, type)}</Alert>
      ) : (
        <ChunkList
          {...props}
          hasMore={hasMore}
          base={base}
          fullName={`${owner}/${repo}`}
        />
      )}
    </div>
  );
}
