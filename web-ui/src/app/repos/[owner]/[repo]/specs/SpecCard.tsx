import Link from 'next/link';
import CoverageBar, { type CoverageCounts } from '@/components/CoverageBar';
import InlineMarkdown from '@/components/InlineMarkdown';
import styles from './SpecCard.module.css';

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
      <div className={styles.head}>
        <h3 className={styles.title}>{spec.title}</h3>
        <Link href={detailHref} className={`btn-secondary ${styles.details}`}>
          Details
        </Link>
      </div>
      <span className={`meta ${styles.path}`}>{spec.spec_path}</span>
      {spec.summary && <p className={styles.summary}><InlineMarkdown text={spec.summary} /></p>}
      <div className={styles.bar}>
        <CoverageBar coverage={spec.coverage} />
      </div>
    </div>
  );
}
