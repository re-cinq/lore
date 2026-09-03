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
  document: SourceItem,
  truncated: boolean,
): [string, string][] {
  const attrs: [string, string][] = [];

  if (document.source_path) {
    attrs.push(["source", document.source_path]);
  }

  if (document.content_type) {
    attrs.push(["type", document.content_type]);
  }

  if (document.repo) {
    attrs.push(["repo", document.repo]);
  }

  if (typeof document.score === "number") {
    attrs.push(["relevance", document.score.toFixed(2)]);
  }
  attrs.push(["tokens", String(document.tokens)]);

  if (truncated) {
    attrs.push(["truncated", "true"]);
  }

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
      children: section.items.map<TagNode>((document, i) => ({
        tag: "document",
        attrs: documentAttrs(
          document,
          section.truncated && i === section.items.length - 1,
        ),
        content: document.text,
        contentType: document.content_type,
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
