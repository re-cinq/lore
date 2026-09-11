"use client";

import { useState } from "react";
import GitHubMarkdown from "@/components/GitHubMarkdown";
import styles from "./ReadmeBox.module.css";
import { resolveUrl, splitBlocks } from "./readme-markdown";

interface ReadmeBoxProps {
  markdown: string;
  /** Base for `src` URLs — raw.githubusercontent, so images load rather than 404 on the HTML page. */
  rawBaseUrl: string;
  /** Base for `href` URLs — the repo's HTML tree, so links land where a reader expects. */
  htmlUrl: string;
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

/** The README as GitHub renders it, with image sources resolved against raw content and links against the repo tree. */
function ReadmeMarkdown({ markdown, rawBaseUrl, htmlUrl }: ReadmeBoxProps) {
  return (
    <GitHubMarkdown
      markdown={markdown}
      urlTransform={(url, key) =>
        resolveUrl(url, key === "src" ? rawBaseUrl : htmlUrl)
      }
    />
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
