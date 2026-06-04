import Link from 'next/link';
import CoverageBar, { type CoverageCounts } from '@/components/CoverageBar';
import SpecDetails, { type StatementInfo } from '../SpecDetails';

/** The resolved spec, or null when no spec exists at the path. */
export interface SpecDetailData {
  title: string;
  content: string;
  statements: StatementInfo[];
  counts: CoverageCounts;
}

export interface SpecDetailViewProps {
  fullName: string;
  filePath: string;
  specsLink: string;
  spec: SpecDetailData | null;
}

/**
 * Presentational view for one spec's detail page. Pure render — all data
 * (chunk fetch, reassembly, coverage derivation) is resolved by the
 * container (`page.tsx`) and handed down as props.
 */
export default function SpecDetailView({ fullName, filePath, specsLink, spec }: SpecDetailViewProps) {
  if (!spec) {
    return (
      <div>
        <div className="breadcrumb">
          <Link href={specsLink}>Specifications</Link> / {filePath}
        </div>
        <h1>Not Found</h1>
        <div className="empty-state">
          <p>No spec found at &quot;{filePath}&quot; for {fullName}.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="breadcrumb">
        <Link href={specsLink}>Specifications</Link> / <strong>{spec.title}</strong>
      </div>
      <h1>{spec.title}</h1>
      <p className="meta" style={{ fontFamily: 'var(--font-mono)', marginTop: 0, marginBottom: 16 }}>{filePath}</p>
      <div style={{ marginBottom: 20 }}>
        <CoverageBar coverage={spec.counts} size="md" />
      </div>
      <SpecDetails repo={fullName} content={spec.content} statements={spec.statements} />
    </div>
  );
}
