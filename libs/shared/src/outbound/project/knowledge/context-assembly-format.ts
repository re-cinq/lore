/** Pure serialization + dedup helpers for context assembly; XML-tagged format (chunks with provenance + markdown) for agents + debug view. */

export interface SourceItem {
  text: string;
  tokens: number;
  source_path?: string;
  content_type?: string;
  repo?: string;
  score?: number;
  /** Cosine similarity to the question, comparable across sections where `score` is ranked within one; absent on anything a vector search did not measure. */
  similarity?: number;
  ingested_at?: string;
  content_hash?: string;
}

export interface SerializedSection {
  header: string;
  source: string;
  priority: number;
  documents: SourceItem[];
  truncated: boolean;
}

export interface ContextMeta {
  query: string;
  template: string;
  budget: number;
}

// A document is its best few chunks, not its single best: the chunk that matched a question is often the one beside the chunk that answers it (an ADR's Context beside its Decision).
const CHUNKS_PER_DOCUMENT = 3;

/** One item per document: the chunks sharing a source_path are merged, best first, into one item at the rank of the best; then items sharing a content_hash collapse to one — a file and its copied twin at another path are one document. Every survivor keeps its rank: the list arrives score-ordered and leaves that way. */
export function dedupeItems(sources: SourceItem[]): SourceItem[] {
  return collapseBy(mergeChunksByPath(sources), (it) => it.content_hash);
}

function mergeChunksByPath(sources: SourceItem[]): SourceItem[] {
  const chunksOf = chunksByPath(sources);
  const emitted = new Set<string>();

  return sources.flatMap((it) => {
    if (!it.source_path) {
      return [it];
    }

    if (emitted.has(it.source_path)) {
      return [];
    }
    emitted.add(it.source_path);

    return [mergedDocument(chunksOf.get(it.source_path) ?? [it])];
  });
}

function chunksByPath(sources: SourceItem[]): Map<string, SourceItem[]> {
  const chunksOf = new Map<string, SourceItem[]>();

  for (const it of sources.filter((keyed) => keyed.source_path)) {
    const path = it.source_path as string;
    const chunks = chunksOf.get(path) ?? [];

    chunks.push(it);
    chunksOf.set(path, chunks);
  }

  return chunksOf;
}

/** The best chunks of one document as one item: the best chunk's provenance, the texts joined best first so a cap cuts the least relevant. */
function mergedDocument(chunks: SourceItem[]): SourceItem {
  const best = [...chunks]
    .sort((a, b) => (isBetter(a, b) ? -1 : 1))
    .slice(0, CHUNKS_PER_DOCUMENT);

  if (best.length === 1) {
    return best[0];
  }
  const similarities = best.flatMap((chunk) =>
    chunk.similarity === undefined ? [] : [chunk.similarity],
  );

  return {
    ...best[0],
    text: best.map((chunk) => chunk.text).join("\n\n"),
    tokens: best.reduce((sum, chunk) => sum + chunk.tokens, 0),
    ...(similarities.length > 0
      ? { similarity: Math.max(...similarities) }
      : {}),
  };
}

/** One item per key, the better one winning at its own position; items without a key pass through in place. */
function collapseBy(
  sources: SourceItem[],
  keyOf: (it: SourceItem) => string | undefined,
): SourceItem[] {
  const winners = new Map<string, SourceItem>();

  for (const it of sources) {
    const key = keyOf(it);
    const current = key ? winners.get(key) : undefined;

    if (key && (!current || isBetter(it, current))) {
      winners.set(key, it);
    }
  }

  return sources.filter((it) => {
    const key = keyOf(it);

    return !key || winners.get(key) === it;
  });
}

function isBetter(candidate: SourceItem, current: SourceItem): boolean {
  const a = candidate.score ?? -Infinity;
  const b = current.score ?? -Infinity;

  if (a !== b) {
    return a > b;
  }
  const ai = candidate.ingested_at
    ? Date.parse(candidate.ingested_at)
    : -Infinity;
  const bi = current.ingested_at ? Date.parse(current.ingested_at) : -Infinity;

  return ai > bi;
}

export function serializeContext(
  meta: ContextMeta,
  sections: SerializedSection[],
): string {
  const inner = sections.map(serializeSection).join("\n");
  const open = `<context query="${escapeXmlAttr(meta.query)}" template="${escapeXmlAttr(meta.template)}" budget="${meta.budget}">`;

  return `${open}\n${inner}\n</context>`;
}

export function serializeSection(section: SerializedSection): string {
  const { documents } = section;
  const lastIndex = documents.length - 1;
  const inner = documents
    .map((it, i) =>
      serializeDocument(it, {
        truncated: section.truncated && i === lastIndex,
      }),
    )
    .join("\n");
  const open = `<section name="${escapeXmlAttr(section.header)}" source="${escapeXmlAttr(section.source)}" priority="${section.priority}">`;

  return `${open}\n${inner}\n</section>`;
}

export function serializeDocument(
  source: SourceItem,
  opts: { truncated?: boolean } = {},
): string {
  const attrs = documentAttrs(source, opts).filter(Boolean).join(" ");

  return `<document ${attrs}>\n${source.text}\n</document>`;
}

function documentAttrs(
  source: SourceItem,
  opts: { truncated?: boolean },
): string[] {
  return [
    source.source_path ? `source="${escapeXmlAttr(source.source_path)}"` : "",
    source.content_type ? `type="${escapeXmlAttr(source.content_type)}"` : "",
    source.repo ? `repo="${escapeXmlAttr(source.repo)}"` : "",
    typeof source.score === "number"
      ? `relevance="${source.score.toFixed(2)}"`
      : "",
    `tokens="${source.tokens}"`,
    opts.truncated ? 'truncated="true"' : "",
  ];
}

export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
