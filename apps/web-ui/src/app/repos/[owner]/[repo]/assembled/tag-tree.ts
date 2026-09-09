import type { AssemblyTrace, SourceItem, TraceSection } from "./trace-types";

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
  const attrs = optionalDocumentAttrs(document);

  attrs.push(["tokens", String(document.tokens)]);

  if (truncated) {
    attrs.push(["truncated", "true"]);
  }

  return attrs;
}

/** Provenance that is only there when it applies: a document assembled from live state has no source path, and one pulled in by rule has no relevance score. */
function optionalDocumentAttrs(document: SourceItem): [string, string][] {
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

  return attrs;
}

/** Build nested tag tree for TagBox from trace. */
export function buildTagTree(trace: AssemblyTrace): TagNode {
  return {
    tag: "context",
    attrs: [
      ["query", trace.query],
      ["template", trace.template],
      ["budget", String(trace.effectiveBudget)],
    ],
    children: sectionNodes(trace),
  };
}

/** Included sections only — the trace cards are what explain the omitted ones. */
function sectionNodes(trace: AssemblyTrace): TagNode[] {
  const included = trace.sections.filter((s) => s.included);

  return included.map<TagNode>((section) => ({
    tag: "section",
    attrs: [
      ["name", section.header],
      ["source", section.source],
      ["priority", String(section.priority)],
    ],
    children: documentNodes(section),
  }));
}

/** The last document of a truncated section is the one that got cut. */
function documentNodes(section: TraceSection): TagNode[] {
  return section.items.map<TagNode>((document, i) => ({
    tag: "document",
    attrs: documentAttrs(
      document,
      section.truncated && i === section.items.length - 1,
    ),
    content: document.text,
    contentType: document.content_type,
  }));
}
