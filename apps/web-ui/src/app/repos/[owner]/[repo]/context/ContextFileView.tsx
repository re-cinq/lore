import Link from "next/link";
import ChunkBody from "./ChunkBody";
import { type ChunkMeta } from "@/lib/chunk-presenter";
import { contentTypeOf } from "@/lib/content-types";
import styles from "./ContextFileView.module.css";
import type { components } from "@/lib/api/schema";

/** The three chunk fields this view renders, typed by the contract. */
export type ContextFileChunk = Pick<
  components["schemas"]["ChunkList"]["chunks"][number],
  "id" | "content_type" | "content"
> & { metadata: ChunkMeta | null };

export interface ContextFileGroup {
  /** owner/name (or 'unknown') — used for GitHub links + the repo label. */
  repo: string;
  /** "view in repo →" target in the global view; null/absent per-repo. */
  repoHref?: string | null;
  branch?: string;
  chunks: ContextFileChunk[];
}

export interface ContextFileViewProps {
  filePath: string;
  /** Breadcrumb root — the list route this file belongs to. */
  contextLink: string;
  /** One group per repo. Per-repo detail passes a single group. */
  groups: ContextFileGroup[];
}

function basename(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

/** Per-file context detail: full chunks rendered richly via ChunkBody (per-repo or global). */
/** The same path can be absent while the page itself is valid — a file ingested under another repo, or one removed since. */
function FileNotFound({
  filePath,
  contextLink,
}: {
  filePath: string;
  contextLink: string;
}) {
  return (
    <div>
      <div className="breadcrumb">
        <Link href={contextLink}>Context</Link> / {filePath}
      </div>
      <h1>Not Found</h1>
      <div className="empty-state">
        <p>No context found at &quot;{filePath}&quot;.</p>
      </div>
    </div>
  );
}

/** One repo's chunks for this path. The header appears only when there is more than one repo to tell apart, and the rules separate chunks WITHIN a repo from the boundary between repos. */
function RepoChunkGroup({
  group: g,
  filePath,
  showHeader,
  lastGroup,
}: {
  group: ContextFileViewProps["groups"][number];
  filePath: string;
  showHeader: boolean;
  lastGroup: boolean;
}) {
  return (
    <div key={g.repo} className={styles.group}>
      {showHeader && (
        <div className={styles.groupHeader}>
          <span className="meta">repo: {g.repo}</span>
          {g.repoHref && (
            <Link href={g.repoHref} className="meta">
              view in repo →
            </Link>
          )}
        </div>
      )}
      {g.chunks.map((c, i) => (
        <div key={c.id}>
          <ChunkBody
            content={c.content}
            contentType={contentTypeOf(c.content_type)}
            filePath={filePath}
            repo={g.repo}
            branch={g.branch ?? "main"}
            metadata={c.metadata ?? undefined}
          />
          {i < g.chunks.length - 1 && (
            <hr className={`${styles.hr} ${styles.chunkRule}`} />
          )}
        </div>
      ))}
      {!lastGroup && <hr className={`${styles.hr} ${styles.groupRule}`} />}
    </div>
  );
}

export default function ContextFileView({
  filePath,
  contextLink,
  groups,
}: ContextFileViewProps) {
  const total = groups.reduce((n, g) => n + g.chunks.length, 0);

  if (total === 0) {
    return <FileNotFound filePath={filePath} contextLink={contextLink} />;
  }

  const showGroupHeader = groups.length > 1 || groups.some((g) => g.repoHref);

  return (
    <div>
      <div className="breadcrumb">
        <Link href={contextLink}>Context</Link> /{" "}
        <strong>{basename(filePath)}</strong>
      </div>
      <h1>{basename(filePath)}</h1>
      <p className={`meta ${styles.path}`}>{filePath}</p>

      {groups.map((g, gi) => (
        <RepoChunkGroup
          key={g.repo}
          group={g}
          filePath={filePath}
          showHeader={showGroupHeader}
          lastGroup={gi === groups.length - 1}
        />
      ))}
    </div>
  );
}
