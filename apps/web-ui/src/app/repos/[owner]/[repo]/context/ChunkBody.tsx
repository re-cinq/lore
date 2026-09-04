"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import { resolveHref, blobUrl } from "@/lib/github-links";
import { languageForPath, fenceFor } from "@/lib/code-lang";
import { chunkHeader, type ChunkMeta } from "@/lib/chunk-presenter";
import readme from "../ReadmeBox.module.css";
import styles from "./ChunkBody.module.css";

/** Non-code types render as markdown prose (pull_request/rule/etc). */
const CODE_TYPE = "code";

function codeFence(content: string, filePath: string): string {
  const fence = fenceFor(content);

  return `${fence}${languageForPath(filePath)}\n${content}\n${fence}`;
}

function markdownFor(
  isCode: boolean,
  content: string,
  filePath: string,
): string {
  return isCode ? codeFence(content, filePath) : content;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rehypePluginsFor(isCode: boolean): any[] {
  return isCode
    ? [rehypeHighlight]
    : [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], rehypeHighlight];
}

function codeLineRange(
  isCode: boolean,
  metadata: ChunkMeta | undefined,
): { start?: number; end?: number } {
  if (!isCode || !metadata) {
    return {};
  }

  return { start: metadata.start_line, end: metadata.end_line };
}

function wrapperClass(preview: boolean): string {
  return `${readme.readme}${preview ? ` ${styles.previewBox}` : ""}`;
}

function ChunkHeader({
  headerLabel,
  ghHref,
}: {
  headerLabel: string;
  ghHref: string;
}) {
  if (!headerLabel && !ghHref) {
    return null;
  }

  return (
    <div className={styles.chunkHeader}>
      {headerLabel && <span className={styles.headerLabel}>{headerLabel}</span>}
      {ghHref && (
        <a
          className={styles.headerLink}
          href={ghHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on GitHub ↗
        </a>
      )}
    </div>
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

/** Render ingested chunk: prose→ReactMarkdown with GitHub links, code→highlight.js. */
export default function ChunkBody({
  content,
  contentType,
  filePath,
  repo,
  branch = "main",
  metadata,
  preview = false,
}: ChunkBodyProps) {
  const isCode = contentType === CODE_TYPE;

  const mdComponents = useMemo(
    () => ({
      a(props: React.ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
        const { href, children, node: _node, ...rest } = props;
        const { href: resolved, external } = resolveHref(
          href ?? "",
          repo,
          branch,
        );
        const ext = external
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {};

        return (
          <a href={resolved} {...ext} {...rest}>
            {children}
          </a>
        );
      },
    }),
    [repo, branch],
  );

  const markdown = markdownFor(isCode, content, filePath);
  const rehypePlugins = rehypePluginsFor(isCode);
  const headerLabel = chunkHeader(contentType, metadata);
  const ghHref = blobUrl(
    repo,
    branch,
    filePath,
    codeLineRange(isCode, metadata),
  );

  return (
    <div>
      {!preview && <ChunkHeader headerLabel={headerLabel} ghHref={ghHref} />}
      <div className={wrapperClass(preview)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={rehypePlugins}
          components={mdComponents}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}
