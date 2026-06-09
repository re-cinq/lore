// Presentational (data-down) renderer for one spec reconstructed from the
// spec-traceability graph (the source of truth) via the mcp-server /trace API.
// Shows ordered sections + statements, each statement's state, drift/violation
// metadata, and the test/code/ADR nodes it links to, plus document coverage.
// Types mirror the API JSON — web-ui is not a workspace member, so it cannot
// import @re-cinq/lore-shared.

export type TraceStatementState = 'tested' | 'untested' | 'narrative';

export interface TraceLinkRef {
  kind: 'test' | 'code' | 'adr';
  label: string;
  path?: string;
  line?: number;
  detail?: string;
}

export interface TraceSection {
  uid: string;
  heading: string;
  ordinal: number;
  level?: number;
}

export interface TraceStatement {
  uid: string;
  ordinal: number;
  text: string;
  state: TraceStatementState;
  sectionUid?: string;
  links: TraceLinkRef[];
  drifted?: boolean;
  violated?: boolean;
}

export interface TraceCoverage {
  testable: number;
  covered: number;
  untestable: number;
  ratio: number;
}

export interface TraceDocument {
  filePath: string;
  sections: TraceSection[];
  statements: TraceStatement[];
  coverage: TraceCoverage;
}

const UNGROUPED = '__ungrouped__';
const STATE_COLOR: Record<TraceStatementState, string> = {
  tested: '#16a34a',
  untested: '#d97706',
  narrative: 'var(--text-muted)',
};

export function githubHref(repo: string, path: string, line?: number): string {
  const base = `https://github.com/${repo}/blob/main/${path}`;
  return line ? `${base}#L${line}` : base;
}

/** Groups statements under their section uid (or UNGROUPED when the section is absent), preserving order. */
export function groupBySection(doc: TraceDocument): Map<string, TraceStatement[]> {
  const known = new Set(doc.sections.map((s) => s.uid));
  const groups = new Map<string, TraceStatement[]>();
  for (const statement of doc.statements) {
    const key = statement.sectionUid && known.has(statement.sectionUid) ? statement.sectionUid : UNGROUPED;
    const bucket = groups.get(key) ?? [];
    if (!groups.has(key)) groups.set(key, bucket);
    bucket.push(statement);
  }
  return groups;
}

function LinkChip({ repo, link }: { repo: string; link: TraceLinkRef }) {
  const label = (
    <span data-link-kind={link.kind} title={link.detail}>
      <span style={{ color: 'var(--text-muted)', marginRight: 4, fontSize: 11, textTransform: 'uppercase' }}>{link.kind}</span>
      <span>{link.label}</span>
    </span>
  );
  return link.path ? (
    <a href={githubHref(repo, link.path, link.line)} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>
      {label}
    </a>
  ) : (
    <span style={{ marginRight: 8 }}>{label}</span>
  );
}

function StatementRow({ repo, statement }: { repo: string; statement: TraceStatement }) {
  return (
    <li data-state={statement.state} style={{ borderLeft: `3px solid ${STATE_COLOR[statement.state]}`, paddingLeft: 10, marginBottom: 10 }}>
      <div>
        <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>#{statement.ordinal}</span>
        <span data-state-badge={statement.state} style={{ color: STATE_COLOR[statement.state] }}>
          {statement.state}
        </span>
        {statement.drifted ? <span data-drifted="true" style={{ color: '#dc2626', marginLeft: 8 }}>drifted</span> : null}
        {statement.violated ? <span data-violated="true" style={{ color: '#dc2626', marginLeft: 8 }}>violated</span> : null}
      </div>
      <p style={{ margin: '4px 0' }}>{statement.text}</p>
      {statement.links.length > 0 ? (
        <div style={{ fontSize: 13 }}>
          {statement.links.map((link, i) => (
            <LinkChip key={`${link.kind}-${i}`} repo={repo} link={link} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

export default function TraceDocumentView({ repo, doc }: { repo: string; doc: TraceDocument }) {
  const groups = groupBySection(doc);
  const sectioned = doc.sections.filter((section) => groups.has(section.uid));
  const ungrouped = groups.get(UNGROUPED);

  return (
    <div>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{doc.filePath}</h1>
        <p className="meta">
          Coverage: {doc.coverage.covered} / {doc.coverage.testable} statements ({Math.round(doc.coverage.ratio * 100)}%)
          {doc.coverage.untestable > 0 ? ` · ${doc.coverage.untestable} narrative` : ''}
        </p>
      </header>

      {sectioned.map((section) => (
        <section key={section.uid} style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16 }}>{section.heading}</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {groups.get(section.uid)!.map((statement) => (
              <StatementRow key={statement.uid} repo={repo} statement={statement} />
            ))}
          </ul>
        </section>
      ))}

      {ungrouped ? (
        <section style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16 }}>(ungrouped)</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {ungrouped.map((statement) => (
              <StatementRow key={statement.uid} repo={repo} statement={statement} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
