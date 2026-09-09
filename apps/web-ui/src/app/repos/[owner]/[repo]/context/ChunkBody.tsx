"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import { blobUrl } from "@/lib/github-links";
import { useResolvedMarkdownLinks } from "@/app/repos/[owner]/[repo]/useResolvedMarkdownLinks";
import { languageForPath, fenceFor } from "@/lib/code-lang";
import { chunkHeader, type ChunkMeta } from "@/lib/chunk-presenter";
import readme from "../ReadmeBox.module.css";
import styles from "./ChunkBody.module.css";

/** Non-code types render as markdown prose (pull_request/rule/etc). */
// A test chunk is source too: fenced, highlighted, and linked by line range.
const CODE_TYPES = new Set(["code", "test"]);

type ChunkKind = "code" | "prose";

const WRAPPER_CLASS = readme.readme;
const PREVIEW_WRAPPER_CLASS = `${readme.readme} ${styles.previewBox}`;

function codeFence(content: string, filePath: string): string {
  const fence = fenceFor(content);

  return `${fence}${languageForPath(filePath)}\n${content}\n${fence}`;
}

function markdownFor(
  kind: ChunkKind,
  content: string,
  filePath: string,
): string {
  return kind === "code" ? codeFence(content, filePath) : content;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rehypePluginsFor(kind: ChunkKind): any[] {
  return kind === "code"
    ? [rehypeHighlight]
    : [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], rehypeHighlight];
}

function codeLineRange(
  kind: ChunkKind,
  metadata: ChunkMeta | undefined,
): { start?: number; end?: number } {
  if (kind !== "code" || !metadata) {
    return {};
  }

  return { start: metadata.start_line, end: metadata.end_line };
}

interface ChunkHeaderProps {
  headerLabel: string;
  ghHref: string;
}

function ChunkHeader({ headerLabel, ghHref }: ChunkHeaderProps) {
  if (!headerLabel && !ghHref) {
    return null;
  }

  return (
    <div className={styles.chunkHeader}>
      {headerLabel && <span className={styles.headerLabel}>{headerLabel}</span>}
      {ghHref && <GitHubLink href={ghHref} />}
    </div>
  );
}

function GitHubLink({ href }: { href: string }) {
  return (
    <a
      className={styles.headerLink}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      View on GitHub ↗
    </a>
  );
}

export interface ChunkBodyProps {
  content: string;
  contentType: string;
  filePath: string;
  /** owner/name of the chunk's repo — resolves relative links + the GitHub button. */
  repo: string;
  branch?: string;
  metadata?: ChunkMeta;
  /** List mode: clamp height with a fade, drop the header + GitHub button. */
  preview?: boolean;
}

/** Where this chunk lives on GitHub. A code chunk carries its line range into the fragment so the link lands on the chunk rather than the top of the file; prose chunks have no range to point at. */
function ghHrefFor({
  repo,
  branch,
  filePath,
  kind,
  metadata,
}: {
  repo: string;
  branch: string;
  filePath: string;
  kind: ChunkKind;
  metadata?: ChunkMeta;
}) {
  return blobUrl(repo, branch, filePath, codeLineRange(kind, metadata));
}

/** The chunk's body. Code arrives already fenced by `markdownFor`, so both content kinds go through the same markdown renderer and differ only in the plugins they carry. */
interface ChunkMarkdownProps {
  markdown: string;
  rehypePlugins: React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"];
  components: React.ComponentProps<typeof ReactMarkdown>["components"];
  className: string;
}

function ChunkMarkdown({
  markdown,
  rehypePlugins,
  components,
  className,
}: ChunkMarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

/** Render ingested chunk: prose→ReactMarkdown with GitHub links, code→highlight.js. */
export default function ChunkBody(props: ChunkBodyProps) {
  const view = useChunkView(props);

  return (
    <div>
      {!props.preview && (
        <ChunkHeader headerLabel={view.headerLabel} ghHref={view.ghHref} />
      )}
      <ChunkMarkdown
        markdown={view.markdown}
        rehypePlugins={view.rehypePlugins}
        components={view.components}
        className={props.preview ? PREVIEW_WRAPPER_CLASS : WRAPPER_CLASS}
      />
    </div>
  );
}

/** Everything the two halves of the body need, derived once: the content kind decides the fencing, the plugins and whether the GitHub link carries a line range. */
function useChunkView({
  content,
  contentType,
  filePath,
  repo,
  branch = "main",
  metadata,
}: ChunkBodyProps) {
  const kind: ChunkKind = CODE_TYPES.has(contentType) ? "code" : "prose";

  return {
    components: useResolvedMarkdownLinks(repo, branch),
    markdown: markdownFor(kind, content, filePath),
    rehypePlugins: rehypePluginsFor(kind),
    headerLabel: chunkHeader(contentType, metadata),
    ghHref: ghHrefFor({ repo, branch, filePath, kind, metadata }),
  };
}
