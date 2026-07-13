"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import { resolveHref, blobUrl } from "@/lib/github-links";
import { languageForPath, fenceFor } from "@/lib/code-lang";
import { chunkHeader, type ChunkMeta } from "@/lib/chunk-presenter";
import readme from "../ReadmeBox.module.css";
import styles from "./ChunkBody.module.css";

/** Content types whose `content` is markdown (rendered as prose). Everything
 * that isn't `code` falls back to this branch — `pull_request`/`rule` and any
 * future text type render fine as markdown. */
const CODE_TYPE = "code";

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

/**
 * Renders ONE ingested chunk richly. Prose (`doc`/`adr`/`spec`/`pull_request`/
 * `rule`) goes through ReactMarkdown with repo-relative links rewritten to
 * GitHub (new tab); `code` is run through the same pipeline inside a synthesized
 * fenced block so highlight.js colors it. Reused by the list cards (preview)
 * and the per-file detail views.
 */
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

  const fence = isCode ? fenceFor(content) : "";
  const markdown = isCode
    ? `${fence}${languageForPath(filePath)}\n${content}\n${fence}`
    : content;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rehypePlugins: any[] = isCode
    ? [rehypeHighlight]
    : [rehypeRaw, rehypeHighlight];

  const headerLabel = chunkHeader(contentType, metadata);
  const ghHref = blobUrl(
    repo,
    branch,
    filePath,
    isCode ? metadata?.start_line : undefined,
    isCode ? metadata?.end_line : undefined,
  );

  return (
    <div>
      {!preview && (headerLabel || ghHref) && (
        <div className={styles.chunkHeader}>
          {headerLabel && (
            <span className={styles.headerLabel}>{headerLabel}</span>
          )}
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
      )}
      <div
        className={`${readme.readme}${preview ? ` ${styles.previewBox}` : ""}`}
      >
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
