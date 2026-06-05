/**
 * Pure serialization + dedup helpers for context assembly.
 *
 * The assembled context is emitted as XML-tagged documents rather than a
 * markdown blob: every chunk carries its provenance in tag attributes, and its
 * (markdown) content is contained inside the tag, so the chunks' own `##`
 * headings and YAML `---` fences can no longer collide with the structural
 * skeleton. This is the format agents and the prompt-debug view both consume.
 */

export interface SourceItem {
  text: string;
  tokens: number;
  source_path?: string;
  content_type?: string;
  repo?: string;
  score?: number;
  ingested_at?: string;
}

export interface SerializedSection {
  header: string;
  source: string;
  priority: number;
  items: SourceItem[];
  truncated: boolean;
}

export interface ContextMeta {
  query: string;
  template: string;
  budget: number;
}

export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Collapse items sharing a source_path to one, keeping the highest-scoring (then
 * most recently ingested) copy. Items without a source_path are never merged —
 * memories, facts, and graph edges have no canonical path to dedup on.
 */
export function dedupeItems(items: SourceItem[]): SourceItem[] {
  const byPath = new Map<string, SourceItem>();
  const passthrough: SourceItem[] = [];

  for (const it of items) {
    if (!it.source_path) {
      passthrough.push(it);
      continue;
    }
    const existing = byPath.get(it.source_path);
    if (!existing || isBetter(it, existing)) {
      byPath.set(it.source_path, it);
    }
  }

  return [...byPath.values(), ...passthrough];
}

function isBetter(candidate: SourceItem, current: SourceItem): boolean {
  const a = candidate.score ?? -Infinity;
  const b = current.score ?? -Infinity;
  if (a !== b) return a > b;
  const ai = candidate.ingested_at ? Date.parse(candidate.ingested_at) : -Infinity;
  const bi = current.ingested_at ? Date.parse(current.ingested_at) : -Infinity;
  return ai > bi;
}

export function serializeDocument(item: SourceItem, opts: { truncated?: boolean } = {}): string {
  const attrs = [
    item.source_path ? `source="${escapeXmlAttr(item.source_path)}"` : '',
    item.content_type ? `type="${escapeXmlAttr(item.content_type)}"` : '',
    item.repo ? `repo="${escapeXmlAttr(item.repo)}"` : '',
    typeof item.score === 'number' ? `relevance="${item.score.toFixed(2)}"` : '',
    `tokens="${item.tokens}"`,
    opts.truncated ? 'truncated="true"' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<document ${attrs}>\n${item.text}\n</document>`;
}

export function serializeSection(section: SerializedSection): string {
  const lastIndex = section.items.length - 1;
  const inner = section.items
    .map((it, i) => serializeDocument(it, { truncated: section.truncated && i === lastIndex }))
    .join('\n');
  const open = `<section name="${escapeXmlAttr(section.header)}" source="${escapeXmlAttr(section.source)}" priority="${section.priority}">`;
  return `${open}\n${inner}\n</section>`;
}

export function serializeContext(meta: ContextMeta, sections: SerializedSection[]): string {
  const inner = sections.map(serializeSection).join('\n');
  const open = `<context query="${escapeXmlAttr(meta.query)}" template="${escapeXmlAttr(meta.template)}" budget="${meta.budget}">`;
  return `${open}\n${inner}\n</context>`;
}
