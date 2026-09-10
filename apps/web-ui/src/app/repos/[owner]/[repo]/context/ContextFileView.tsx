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

/** Per-file context detail: full chunks rendered richly via ChunkBody (per-repo or global). */
export default function ContextFileView({
  filePath,
  contextLink,
  groups,
}: ContextFileViewProps) {
  const total = groups.reduce((n, g) => n + g.chunks.length, 0);

  if (total === 0) {
    return <FileNotFound filePath={filePath} contextLink={contextLink} />;
  }

  return (
    <div>
      <FileHeader filePath={filePath} contextLink={contextLink} />
      <RepoChunkGroups filePath={filePath} groups={groups} />
    </div>
  );
}

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

/** Breadcrumb and title name the file; the full path says where it lives, which the basename alone does not. */
function FileHeader({
  filePath,
  contextLink,
}: Pick<ContextFileViewProps, "filePath" | "contextLink">) {
  return (
    <>
      <div className="breadcrumb">
        <Link href={contextLink}>Context</Link> /{" "}
        <strong>{basename(filePath)}</strong>
      </div>
      <h1>{basename(filePath)}</h1>
      <p className={`meta ${styles.path}`}>{filePath}</p>
    </>
  );
}

function basename(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

/** The group header appears only when there is more than one repo to tell apart. */
function RepoChunkGroups({
  filePath,
  groups,
}: Pick<ContextFileViewProps, "filePath" | "groups">) {
  const showGroupHeader = groups.length > 1 || groups.some((g) => g.repoHref);

  return groups.map((g, gi) => (
    <RepoChunkGroup
      key={g.repo}
      group={g}
      filePath={filePath}
      showHeader={showGroupHeader}
      lastGroup={gi === groups.length - 1}
    />
  ));
}

interface RepoChunkGroupProps {
  group: ContextFileViewProps["groups"][number];
  filePath: string;
  showHeader: boolean;
  lastGroup: boolean;
}

/** One repo's chunks for this path. The rules separate chunks WITHIN a repo from the boundary between repos. */
function RepoChunkGroup({ group: g, ...props }: RepoChunkGroupProps) {
  return (
    <div key={g.repo} className={styles.group}>
      {props.showHeader && <GroupHeader group={g} />}
      {g.chunks.map((c, i) => (
        <ChunkWithRule
          key={c.id}
          chunk={c}
          group={g}
          filePath={props.filePath}
          ruled={i < g.chunks.length - 1}
        />
      ))}
      {!props.lastGroup && (
        <hr className={`${styles.hr} ${styles.groupRule}`} />
      )}
    </div>
  );
}

/** Which repo these chunks came from, and the way back to it. The link is absent in the per-repo view, where the reader is already there. */
function GroupHeader({ group }: { group: ContextFileGroup }) {
  return (
    <div className={styles.groupHeader}>
      <span className="meta">repo: {group.repo}</span>
      {group.repoHref && (
        <Link href={group.repoHref} className="meta">
          view in repo →
        </Link>
      )}
    </div>
  );
}

interface ChunkWithRuleProps {
  chunk: ContextFileChunk;
  group: ContextFileGroup;
  filePath: string;
  ruled: boolean;
}

/** One chunk, with the rule that separates it from the next. The last chunk in a repo takes no rule — the group's own boundary rule follows it instead. */
function ChunkWithRule({ chunk, group, filePath, ruled }: ChunkWithRuleProps) {
  return (
    <div>
      <ChunkBody
        content={chunk.content}
        contentType={contentTypeOf(chunk.content_type)}
        filePath={filePath}
        repo={group.repo}
        branch={group.branch ?? "main"}
        metadata={chunk.metadata ?? undefined}
      />
      {ruled && <hr className={`${styles.hr} ${styles.chunkRule}`} />}
    </div>
  );
}
