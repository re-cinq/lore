import Link from 'next/link';
import CoverageBar, { type CoverageCounts } from '@/components/CoverageBar';
import InlineMarkdown from '@/components/InlineMarkdown';

export interface SpecCardData {
  spec_path: string;
  title: string;
  summary: string;
  coverage: CoverageCounts;
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

  return (
    <div className="spec-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <h3 style={{ margin: 0 }}>{spec.title}</h3>
        <Link href={detailHref} className="btn-secondary" style={{ flexShrink: 0 }}>
          Details
        </Link>
      </div>
      <span className="meta" style={{ fontFamily: 'var(--font-mono)' }}>{spec.spec_path}</span>
      {spec.summary && <p style={{ marginTop: 8 }}><InlineMarkdown text={spec.summary} /></p>}
      <div style={{ marginTop: 10 }}>
        <CoverageBar coverage={spec.coverage} />
      </div>
    </div>
  );
}
