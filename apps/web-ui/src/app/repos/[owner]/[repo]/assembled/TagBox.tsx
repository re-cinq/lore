"use client";

import Markdown from "@/components/Markdown";
import type { TagNode } from "./tag-tree";
import styles from "./TagBox.module.css";

/** The monospace attribute chip that straddles the top border of each box —
 *  black "terminal readout" with a colored tag name and green attribute values. */
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

/** Recursive nested-box renderer: each tag is a bordered div containing its
 *  children (or, at a leaf `document`, its content as markdown or raw text). */
export default function TagBox({
  node,
  raw,
  depth = 0,
}: {
  node: TagNode;
  raw: boolean;
  depth?: number;
}) {
  const isLeaf = node.content !== undefined;
  return (
    <div className={`${styles.box} ${depth % 2 === 1 ? styles.alt : ""}`}>
      <TagChip tag={node.tag} attrs={node.attrs} />
      {isLeaf ? (
        raw ? (
          <pre className={styles.raw}>{node.content}</pre>
        ) : (
          <Markdown markdown={node.content ?? ""} />
        )
      ) : (
        node.children?.map((child, i) => (
          <TagBox key={i} node={child} raw={raw} depth={depth + 1} />
        ))
      )}
    </div>
  );
}
