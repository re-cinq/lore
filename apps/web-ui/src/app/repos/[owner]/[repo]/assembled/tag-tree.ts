import type { AssemblyTrace, SourceItem } from "./trace-types";

/** A node in the rendered tag tree — `context` → `section` → `document` (leaf). */
export interface TagNode {
  tag: string;
  attrs: [string, string][];
  children?: TagNode[];
  content?: string; // leaf document body
  contentType?: string;
}

function documentAttrs(
  item: SourceItem,
  truncated: boolean,
): [string, string][] {
  const attrs: [string, string][] = [];
  if (item.source_path) attrs.push(["source", item.source_path]);
  if (item.content_type) attrs.push(["type", item.content_type]);
  if (item.repo) attrs.push(["repo", item.repo]);
  if (typeof item.score === "number")
    attrs.push(["relevance", item.score.toFixed(2)]);
  attrs.push(["tokens", String(item.tokens)]);
  if (truncated) attrs.push(["truncated", "true"]);
  return attrs;
}

/**
 * Build the nested tag tree the `TagBox` renders, straight from the trace — the
 * same `context → section → document` nesting the XML serializer emits, so the
 * visual tree and the raw XML stay in lockstep. Only INCLUDED sections appear
 * (the per-section trace cards explain the omitted ones).
 */
export function buildTagTree(trace: AssemblyTrace): TagNode {
  const sections = trace.sections
    .filter((s) => s.included)
    .map<TagNode>((section) => ({
      tag: "section",
      attrs: [
        ["name", section.header],
        ["source", section.source],
        ["priority", String(section.priority)],
      ],
      children: section.items.map<TagNode>((item, i) => ({
        tag: "document",
        attrs: documentAttrs(
          item,
          section.truncated && i === section.items.length - 1,
        ),
        content: item.text,
        contentType: item.content_type,
      })),
    }));

  return {
    tag: "context",
    attrs: [
      ["query", trace.query],
      ["template", trace.template],
      ["budget", String(trace.effectiveBudget)],
    ],
    children: sections,
  };
}
