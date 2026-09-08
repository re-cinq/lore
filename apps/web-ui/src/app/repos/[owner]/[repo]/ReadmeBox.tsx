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

/** The expand/collapse control, shown only when the README is long enough to be worth truncating. */
function ReadmeToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`btn-secondary ${styles.toggle}`}
      onClick={onToggle}
    >
      {expanded ? "Read less" : "Read more"}
    </button>
  );
}

export default function ReadmeBox(props: ReadmeBoxProps) {
  const [expanded, setExpanded] = useState(false);
  const blocks = splitBlocks(props.markdown);
  const collapsible = blocks.length > 2;
  const collapsed = blocks.slice(0, 2).join("\n\n");
  const shown = expanded || !collapsible ? props.markdown : collapsed;
  const toggle = () => setExpanded((e) => !e);

  return (
    <div className={styles.readme}>
      <ReadmeMarkdown {...props} markdown={shown} />
      {collapsible && <ReadmeToggle expanded={expanded} onToggle={toggle} />}
    </div>
  );
}
