"use client";

import Markdown from "@/components/Markdown";
import type { TagNode } from "./tag-tree";
import styles from "./TagBox.module.css";

interface TagBoxProps {
  node: TagNode;
  raw: boolean;
  depth?: number;
}

/** Monospace attribute chip: terminal readout with colored tags and green values. */
function TagChip({ tag, attrs }: { tag: string; attrs: [string, string][] }) {
  return (
    <span className={styles.chip}>
      <span className={styles.chipTag}>{tag}</span>
      {attrs.map(([k, v]) => (
        <span key={k}>
          {" "}
          {k}=<span className={styles.chipVal}>&quot;{v}&quot;</span>
        </span>
      ))}
    </span>
  );
}

/** Recursive nested-box renderer: tags as bordered divs, leaves render content. */
export default function TagBox({ node, raw, depth = 0 }: TagBoxProps) {
  return (
    <div className={`${styles.box} ${depth % 2 === 1 ? styles.alt : ""}`}>
      <TagChip tag={node.tag} attrs={node.attrs} />
      <TagBoxBody node={node} raw={raw} depth={depth} />
    </div>
  );
}

/** A leaf renders its own content, raw or as markdown; a branch renders its children one level deeper. */
function TagBoxBody({ node, raw, depth }: Required<TagBoxProps>) {
  if (node.content === undefined) {
    return node.children?.map((child, i) => (
      <TagBox key={i} node={child} raw={raw} depth={depth + 1} />
    ));
  }

  if (raw) {
    return <pre className={styles.raw}>{node.content}</pre>;
  }

  return <Markdown markdown={node.content} />;
}
