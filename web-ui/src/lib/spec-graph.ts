/**
 * Reads the spec-traceability graph for one repo out of Dgraph (the projection
 * the ingest-* tasks build) and flattens it into a {nodes, links} shape a D3
 * force layout can render. Scoped to the interesting traceability subset —
 * Specs and the Statements that carry validated_by/implemented_by edges (not the
 * thousands of narrative statements) — so the graph stays legible. Each node
 * carries display + popover metadata (clean label, file path, line, full text).
 */

export type SpecGraphNodeType = 'Spec' | 'Section' | 'Statement' | 'TestChunk' | 'CodeChunk' | 'ADR';

export type SpecGraphNode = {
  id: string;
  type: SpecGraphNodeType;
  /** Short, human label rendered next to the node. */
  label: string;
  /** File path — the Spec/Test/Code file, or a Statement's parent spec. */
  path?: string;
  /** Start line for Test/Code chunks (for the GitHub file#L link). */
  line?: number;
  /** End line for Test/Code chunks (for the code-preview slice). */
  endLine?: number;
  /** Full text for the popover — statement text or a test name. */
  detail?: string;
};
export type SpecGraphLink = {
  source: string;
  target: string;
  kind: 'in_spec' | 'in_section' | 'has_statement' | 'validated_by' | 'implemented_by' | 'decided_by';
};
export interface SpecGraph {
  nodes: SpecGraphNode[];
  links: SpecGraphLink[];
}

interface DgraphResult {
  q?: Array<{
    uid: string;
    'Spec.file_path'?: string;
    stmts?: Array<{
      uid: string;
      'Statement.text'?: string;
      vb?: Array<{ uid: string; 'TestChunk.file_path'?: string; 'TestChunk.test_name'?: string; 'TestChunk.start_line'?: number; 'TestChunk.end_line'?: number }>;
      ib?: Array<{ uid: string; 'CodeChunk.file_path'?: string; 'CodeChunk.start_line'?: number }>;
      db?: Array<{ uid: string; 'ADR.file_path'?: string; 'ADR.number'?: number }>;
    }>;
  }>;
}

/** "specs/1-lore-platform/spec.md" → "1-lore-platform (spec)"; ".specify/spec.md" → "spec". */
export function specLabel(path: string): string {
  const rel = path.replace(/^specs\//, '').replace(/^\.specify\//, '');
  const parts = rel.split('/');
  const doc = (parts.pop() ?? rel).replace(/\.md$/, '');
  const dir = parts.join('/');
  return dir ? `${dir} (${doc})` : doc;
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

/** "adrs/ADR-016-dark-factory.md" → "ADR-016 (dark-factory)". */
export function adrLabel(path: string): string {
  const base = basename(path).replace(/\.md$/, '');
  const m = base.match(/^(ADR-\d+)-(.*)$/i);
  return m ? `${m[1]} (${m[2]})` : base;
}

/** Pure: Dgraph query result → de-duplicated nodes + links. */
export function flattenSpecGraph(data: DgraphResult): SpecGraph {
  const nodes = new Map<string, SpecGraphNode>();
  const links: SpecGraphLink[] = [];

  for (const spec of data.q ?? []) {
    const specPath = spec['Spec.file_path'] ?? spec.uid;
    nodes.set(spec.uid, { id: spec.uid, type: 'Spec', label: specLabel(specPath), path: specPath });
    for (const st of spec.stmts ?? []) {
      nodes.set(st.uid, { id: st.uid, type: 'Statement', label: '', path: specPath, detail: (st['Statement.text'] ?? '').trim() });
      links.push({ source: spec.uid, target: st.uid, kind: 'in_spec' });
      for (const t of st.vb ?? []) {
        const p = t['TestChunk.file_path'] ?? t.uid;
        nodes.set(t.uid, { id: t.uid, type: 'TestChunk', label: basename(p), path: p, line: t['TestChunk.start_line'], endLine: t['TestChunk.end_line'], detail: t['TestChunk.test_name'] });
        links.push({ source: st.uid, target: t.uid, kind: 'validated_by' });
      }
      for (const c of st.ib ?? []) {
        const p = c['CodeChunk.file_path'] ?? c.uid;
        nodes.set(c.uid, { id: c.uid, type: 'CodeChunk', label: basename(p), path: p, line: c['CodeChunk.start_line'] });
        links.push({ source: st.uid, target: c.uid, kind: 'implemented_by' });
      }
      for (const a of st.db ?? []) {
        const p = a['ADR.file_path'] ?? a.uid;
        nodes.set(a.uid, { id: a.uid, type: 'ADR', label: adrLabel(p), path: p });
        links.push({ source: st.uid, target: a.uid, kind: 'decided_by' });
      }
    }
  }
  return { nodes: [...nodes.values()], links };
}

const DQL = `query specGraph($repo: string) {
  q(func: eq(Spec.repo, $repo)) {
    uid
    Spec.file_path
    stmts: ~Statement.spec @filter(has(Statement.validated_by) OR has(Statement.implemented_by) OR has(Statement.decided_by)) {
      uid
      Statement.text
      vb: Statement.validated_by { uid TestChunk.file_path TestChunk.test_name TestChunk.start_line TestChunk.end_line }
      ib: Statement.implemented_by { uid CodeChunk.file_path CodeChunk.start_line }
      db: Statement.decided_by { uid ADR.file_path ADR.number }
    }
  }
}`;

/** Inner-ring segment: a Section, sized by `total` statements and tinted by `tested` coverage. */
export interface RingSection {
  uid: string;
  heading: string;
  total: number;
  tested: number;
}
/** Outer-ring segment: one Statement, grouped under its section, tinted by `tested`. */
export interface RingStatement {
  uid: string;
  sectionUid: string;
  tested: boolean;
  text: string;
}
export interface SpecRing {
  sections: RingSection[];
  statements: RingStatement[];
}

export const UNGROUPED_SECTION = '__ungrouped__';

interface RingResult {
  q?: Array<{
    uid: string;
    sections?: Array<{ uid: string; 'Section.heading'?: string }>;
    // Statement.section is single-cardinality, so Dgraph returns it as an object.
    stmts?: Array<{ uid: string; v?: number; 'Statement.text'?: string; sec?: { uid: string } }>;
  }>;
}

/** Pure: a spec's two-ring structure — sections (inner) + per-statement coverage (outer). */
export function flattenSpecRing(data: RingResult): SpecRing {
  const spec = data.q?.[0];
  if (!spec) return { sections: [], statements: [] };
  const byUid = new Map<string, RingSection>();
  const order: string[] = [];
  for (const sec of spec.sections ?? []) {
    byUid.set(sec.uid, { uid: sec.uid, heading: sec['Section.heading'] ?? '(section)', total: 0, tested: 0 });
    order.push(sec.uid);
  }
  const ungrouped: RingSection = { uid: UNGROUPED_SECTION, heading: '(ungrouped)', total: 0, tested: 0 };
  const statements: RingStatement[] = [];
  for (const st of spec.stmts ?? []) {
    const secUid = st.sec?.uid;
    const owner = (secUid && byUid.get(secUid)) || ungrouped;
    const tested = (st.v ?? 0) > 0;
    owner.total += 1;
    if (tested) owner.tested += 1;
    statements.push({ uid: st.uid, sectionUid: owner.uid, tested, text: (st['Statement.text'] ?? '').trim() });
  }
  const sections = order.map((u) => byUid.get(u)!);
  if (ungrouped.total > 0) sections.push(ungrouped);
  return { sections, statements };
}

const RING_DQL = `query ring($xid: string) {
  q(func: eq(Spec.xid, $xid)) {
    uid
    sections: Spec.sections { uid Section.heading }
    stmts: ~Statement.spec { uid v: count(Statement.validated_by) Statement.text sec: Statement.section { uid } }
  }
}`;

/** Queries one spec's two-ring structure (sections + per-statement coverage) for expansion. */
export async function fetchSpecRing(repo: string, specPath: string): Promise<SpecRing> {
  const dgraph = process.env.LORE_DGRAPH_HTTP;
  if (!dgraph) return { sections: [], statements: [] };
  try {
    const res = await fetch(`${dgraph}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: RING_DQL, variables: { $xid: `${repo}|${specPath}` } }),
      cache: 'no-store',
    });
    if (!res.ok) return { sections: [], statements: [] };
    const json = (await res.json()) as { data?: RingResult };
    return flattenSpecRing(json.data ?? {});
  } catch {
    return { sections: [], statements: [] };
  }
}

/** Queries Dgraph for a repo's spec graph. Returns an empty graph when Dgraph is unconfigured/unreachable. */
export async function fetchSpecGraph(repo: string): Promise<SpecGraph> {
  const dgraph = process.env.LORE_DGRAPH_HTTP;
  if (!dgraph) return { nodes: [], links: [] };
  try {
    const res = await fetch(`${dgraph}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: DQL, variables: { $repo: repo } }),
      cache: 'no-store',
    });
    if (!res.ok) return { nodes: [], links: [] };
    const json = (await res.json()) as { data?: DgraphResult };
    return flattenSpecGraph(json.data ?? {});
  } catch {
    return { nodes: [], links: [] };
  }
}
