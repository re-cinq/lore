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

/** Global cross-repo context list; pure render with repo labels and detail links. */
/** Two different nothings: a filter that matched nothing offers a way back, while a repo with no ingested context explains when context arrives. Telling them apart is the whole point — the first is the reader's doing, the second is not. */
function ContextEmptyState({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return (
      <EmptyState
        title="No matches for this filter"
        description="No ingested context matches the current search or type filter."
        action={{ href: "/context", label: "Clear filters" }}
      />
    );
  }

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

export default function ContextView({
  type,
  q,
  types,
  chunks,
}: ContextViewProps) {
  return (
    <div>
      <h1>Context</h1>
      <div className={styles.notice}>
        <p className={`meta ${styles.noticeText}`}>
          This is the global view across all repos. For repo-specific context,
          visit <a href="/">Repositories</a> and select a repo.
        </p>
      </div>

      <ContextFilters
        basePath="/context"
        types={types}
        activeType={type}
        q={q}
      />

      {chunks.length === 0 ? (
        <ContextEmptyState filtered={Boolean(q || type)} />
      ) : (
        chunks.map((c) => (
          <ContextCard
            key={c.id}
            chunk={c}
            repo={c.repo ?? ""}
            repoLabel={c.repo ?? undefined}
            detailHref={
              c.file_path
                ? `/context/${encodeURIComponent(c.file_path)}`
                : undefined
            }
          />
        ))
      )}
    </div>
  );
}
