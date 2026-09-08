"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import styles from "./ReadmeBox.module.css";
import { resolveUrl, splitBlocks } from "./readme-markdown";

interface ReadmeBoxProps {
  markdown: string;
  /** Base for `src` URLs — raw.githubusercontent, so images load rather than 404 on the HTML page. */
  rawBaseUrl: string;
  /** Base for `href` URLs — the repo's HTML tree, so links land where a reader expects. */
  htmlUrl: string;
}

/** The README as GitHub renders it. Raw HTML is allowed through but sanitized, since a README is repo content and may carry badge markup a plain markdown pass would drop. */
function ReadmeMarkdown({ markdown, rawBaseUrl, htmlUrl }: ReadmeBoxProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
      urlTransform={(url, key) =>
        resolveUrl(url, key === "src" ? rawBaseUrl : htmlUrl)
      }
    >
      {markdown}
    </ReactMarkdown>
  );
}

export default function ReadmeBox({
  markdown,
  rawBaseUrl,
  htmlUrl,
}: ReadmeBoxProps) {
  const [expanded, setExpanded] = useState(false);

  const blocks = splitBlocks(markdown);
  const collapsible = blocks.length > 2;

  return (
    <div className={styles.readme}>
      <ReadmeMarkdown
        markdown={
          expanded || !collapsible ? markdown : blocks.slice(0, 2).join("\n\n")
        }
        rawBaseUrl={rawBaseUrl}
        htmlUrl={htmlUrl}
      />
      {collapsible && (
        <button
          type="button"
          className={`btn-secondary ${styles.toggle}`}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "Read less" : "Read more"}
        </button>
      )}
    </div>
  );
}
