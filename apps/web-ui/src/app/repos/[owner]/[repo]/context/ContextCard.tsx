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
  /** Link to the per-file detail route. Absent when the chunk has no `file_path` — there is no detail page for it. */
  detailHref?: string;
  /** owner/name of the chunk's repo, for GitHub links inside the preview. */
  repo: string;
  /** Shown only in the global cross-repo view. */
  repoLabel?: string;
}

/** One row in context list: type badge, path, metadata, date, clamped preview. */
export default function ContextCard(props: ContextCardProps) {
  // Both columns permit NULL; untyped/pathless chunks are real rows, not crashes
  const contentType = contentTypeOf(props.chunk.content_type);
  const header = chunkHeader(contentType, props.chunk.metadata ?? null);

  return (
    <div className={styles.card}>
      <CardHead {...props} contentType={contentType} />
      {header && <p className={styles.subhead}>{header}</p>}
      <CardPreview {...props} contentType={contentType} />
    </div>
  );
}

type CardVariantProps = ContextCardProps & { contentType: string };

/** The row's identity line: type badge, path, repo label and ingest date. */
function CardHead({
  chunk,
  contentType,
  detailHref,
  repoLabel,
}: CardVariantProps) {
  return (
    <div className={styles.head}>
      <span className={badgeClassForType(contentType)}>
        {formatEnumLabel(contentType)}
      </span>
      <PathCell filePath={chunk.file_path} detailHref={detailHref} />
      {repoLabel && <span className={styles.repo}>{repoLabel}</span>}
      <DateCell ingestedAt={chunk.ingested_at} />
    </div>
  );
}

function PathCell({
  filePath,
  detailHref,
}: {
  filePath: string | null;
  detailHref?: string;
}) {
  if (detailHref) {
    return (
      <Link href={detailHref} className={styles.path}>
        {filePath}
      </Link>
    );
  }

  return <span className={styles.path}>{filePath ?? "—"}</span>;
}

function DateCell({ ingestedAt }: { ingestedAt: string | null }) {
  return (
    <span className={styles.date}>
      {ingestedAt ? <TimeAgo date={ingestedAt} inline /> : "—"}
    </span>
  );
}

/** The clamped body preview; a pathless chunk still renders, it just has no file to resolve links against. */
function CardPreview({ chunk, contentType, repo }: CardVariantProps) {
  return (
    <ChunkBody
      content={chunk.content}
      contentType={contentType}
      filePath={chunk.file_path ?? ""}
      repo={repo}
      metadata={chunk.metadata ?? undefined}
      preview
    />
  );
}
