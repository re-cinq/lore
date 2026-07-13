import Link from "next/link";
import ChunkBody from "./ChunkBody";
import { badgeClassForType } from "@/lib/content-types";
import { chunkHeader, type ChunkMeta } from "@/lib/chunk-presenter";
import styles from "./ContextCard.module.css";

export interface ContextCardChunk {
  id: string;
  file_path: string;
  content_type: string;
  content: string;
  ingested_at: string;
  metadata?: ChunkMeta | null;
}

export interface ContextCardProps {
  chunk: ContextCardChunk;
  /** Link to the per-file detail route. */
  detailHref: string;
  /** owner/name of the chunk's repo, for GitHub links inside the preview. */
  repo: string;
  /** Shown only in the global cross-repo view. */
  repoLabel?: string;
}

/**
 * One row in a context list: type badge, file path (linked to the detail
 * route), the derived metadata header, ingest date, and a clamped rich
 * preview of the chunk via `ChunkBody`. Pure render.
 */
export default function ContextCard({
  chunk,
  detailHref,
  repo,
  repoLabel,
}: ContextCardProps) {
  const header = chunkHeader(chunk.content_type, chunk.metadata ?? null);
  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={badgeClassForType(chunk.content_type)}>
          {chunk.content_type}
        </span>
        <Link href={detailHref} className={styles.path}>
          {chunk.file_path}
        </Link>
        {repoLabel && <span className={styles.repo}>{repoLabel}</span>}
        <span className={styles.date}>
          {new Date(chunk.ingested_at).toLocaleDateString()}
        </span>
      </div>
      {header && <p className={styles.subhead}>{header}</p>}
      <ChunkBody
        content={chunk.content}
        contentType={chunk.content_type}
        filePath={chunk.file_path}
        repo={repo}
        metadata={chunk.metadata ?? undefined}
        preview
      />
    </div>
  );
}
