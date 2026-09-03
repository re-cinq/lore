import Link from "next/link";
import ChunkBody from "./ChunkBody";
import { badgeClassForType, contentTypeOf } from "@/lib/content-types";
import { chunkHeader, type ChunkMeta } from "@/lib/chunk-presenter";
import { formatEnumLabel } from "@/lib/enum-label";
import { TimeAgo } from "@/components/TimeAgo";
import styles from "./ContextCard.module.css";
import type { components } from "@/lib/api/schema";

/** The five chunk fields the card renders; file_path and content_type are nullable in the contract. */
export type ContextCardChunk = Pick<
  components["schemas"]["ChunkList"]["chunks"][number],
  "id" | "file_path" | "content_type" | "content" | "ingested_at"
> & { metadata?: ChunkMeta | null };

export interface ContextCardProps {
  chunk: ContextCardChunk;
  /** Link to the per-file detail route. */
  /** Absent when the chunk has no `file_path` — there is no detail page for it. */
  detailHref?: string;
  /** owner/name of the chunk's repo, for GitHub links inside the preview. */
  repo: string;
  /** Shown only in the global cross-repo view. */
  repoLabel?: string;
}

/** One row in context list: type badge, path, metadata, date, clamped preview. */
export default function ContextCard({
  chunk,
  detailHref,
  repo,
  repoLabel,
}: ContextCardProps) {
  // Both columns permit NULL; untyped/pathless chunks are real rows, not crashes
  const contentType = contentTypeOf(chunk.content_type);
  const header = chunkHeader(contentType, chunk.metadata ?? null);

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={badgeClassForType(contentType)}>
          {formatEnumLabel(contentType)}
        </span>
        {detailHref ? (
          <Link href={detailHref} className={styles.path}>
            {chunk.file_path}
          </Link>
        ) : (
          <span className={styles.path}>{chunk.file_path ?? "—"}</span>
        )}
        {repoLabel && <span className={styles.repo}>{repoLabel}</span>}
        <span className={styles.date}>
          {chunk.ingested_at ? (
            <TimeAgo date={chunk.ingested_at} inline />
          ) : (
            "—"
          )}
        </span>
      </div>
      {header && <p className={styles.subhead}>{header}</p>}
      <ChunkBody
        content={chunk.content}
        contentType={contentType}
        filePath={chunk.file_path ?? ""}
        repo={repo}
        metadata={chunk.metadata ?? undefined}
        preview
      />
    </div>
  );
}
