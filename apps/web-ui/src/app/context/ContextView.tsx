import ContextFilters from "@/app/repos/[owner]/[repo]/context/ContextFilters";
import ContextCard from "@/app/repos/[owner]/[repo]/context/ContextCard";
import { EmptyState } from "@/components/EmptyState";
import styles from "./ContextView.module.css";
import type { components } from "@/lib/api/schema";

export type ContextChunk = components["schemas"]["ChunkList"]["chunks"][number];

export interface ContextViewProps {
  /** Active content_type filter, or undefined for "All". */
  type?: string;
  /** Active keyword query, or undefined. */
  q?: string;
  /** Distinct content_types present across all repos (drives the chips). */
  types: string[];
  chunks: ContextChunk[];
}

/** Two different nothings: a filter that matched nothing offers a way back, while a repo with no ingested context explains when context arrives. Telling them apart is the whole point — the first is the reader's doing, the second is not. */
function ContextEmptyState({ filtered }: { filtered: boolean }) {
  if (!filtered) {
    return <NothingIngestedState />;
  }

  return (
    <EmptyState
      title="No matches for this filter"
      description="No ingested context matches the current search or type filter."
      action={{ href: "/context", label: "Clear filters" }}
    />
  );
}

function NothingIngestedState() {
  return (
    <EmptyState
      title="Nothing ingested yet"
      description={
        <>
          Context is ingested nightly after a repo is onboarded, or on demand
          via <code>lore_ingest_files</code>.
        </>
      }
    />
  );
}

/** Says which context this is. Worth saying because the per-repo view looks the same and answers a narrower question — a reader who arrived here from a repo page would otherwise read another repo's chunks as that repo's. */
function GlobalScopeNotice() {
  return (
    <div className={styles.notice}>
      <p className={`meta ${styles.noticeText}`}>
        This is the global view across all repos. For repo-specific context,
        visit <a href="/">Repositories</a> and select a repo.
      </p>
    </div>
  );
}

/** One chunk, labelled with the repo it came from. A chunk with no `file_path` came from a source with no file behind it — a memory or a fact — so it gets no detail link rather than one that would 404. */
function GlobalChunkCard({
  chunk,
}: {
  chunk: ContextViewProps["chunks"][number];
}) {
  return (
    <ContextCard
      chunk={chunk}
      repo={chunk.repo ?? ""}
      repoLabel={chunk.repo ?? undefined}
      detailHref={
        chunk.file_path
          ? `/context/${encodeURIComponent(chunk.file_path)}`
          : undefined
      }
    />
  );
}

/** Global cross-repo context list; pure render with repo labels and detail links. */
export default function ContextView(props: ContextViewProps) {
  const { type, q, types, chunks } = props;

  return (
    <div>
      <h1>Context</h1>
      <GlobalScopeNotice />

      <ContextFilters
        basePath="/context"
        types={types}
        activeType={type}
        q={q}
      />

      <ContextChunkList chunks={chunks} filtered={Boolean(q || type)} />
    </div>
  );
}

interface ContextChunkListProps {
  chunks: ContextChunk[];
  filtered: boolean;
}

function ContextChunkList({ chunks, filtered }: ContextChunkListProps) {
  return chunks.length === 0 ? (
    <ContextEmptyState filtered={filtered} />
  ) : (
    <>
      {chunks.map((chunk) => (
        <GlobalChunkCard key={chunk.id} chunk={chunk} />
      ))}
    </>
  );
}
