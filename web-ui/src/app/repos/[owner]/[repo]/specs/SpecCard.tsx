import Link from 'next/link';

export interface SpecCardData {
  spec_path: string;
  title: string;
  summary: string;
  test_count: number;
}

export default function SpecCard({
  owner,
  repo,
  spec,
}: {
  owner: string;
  repo: string;
  spec: SpecCardData;
}) {
  const detailHref = `/repos/${owner}/${repo}/specs/${encodeURIComponent(spec.spec_path)}`;
  const hasTests = spec.test_count > 0;

  return (
    <div className="spec-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <h3 style={{ margin: 0 }}>{spec.title}</h3>
        <Link href={detailHref} className="btn-secondary" style={{ flexShrink: 0 }}>
          Details
        </Link>
      </div>
      <span className="meta" style={{ fontFamily: 'var(--font-mono)' }}>{spec.spec_path}</span>
      {spec.summary && <p style={{ marginTop: 8 }}>{spec.summary}</p>}
      <div
        className="meta"
        style={{ marginTop: 8, color: hasTests ? 'var(--green, #2e7d32)' : 'var(--muted)' }}
      >
        {hasTests ? `● ${spec.test_count} test${spec.test_count === 1 ? '' : 's'} linked` : '○ no tests linked'}
      </div>
    </div>
  );
}
