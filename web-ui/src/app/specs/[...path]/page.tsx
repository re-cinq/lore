export const dynamic = "force-dynamic";
import Link from 'next/link';
import { queryAllChunks } from '@/lib/db';
import { reassembleSpec, parseSpecTitle } from '@/lib/spec-summary';
import CoverageBar from '@/components/CoverageBar';
import { deriveCoverageFromMarkdown } from '@/lib/spec-coverage-derive';
import SpecDetails, { type StatementInfo } from '@/app/repos/[owner]/[repo]/specs/SpecDetails';
import styles from './page.module.css';

interface SpecChunkRow {
  content: string;
  repo: string | null;
  ingested_at: string;
}

export default async function SpecDetailPage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const filePath = path.map(decodeURIComponent).join('/');

  const allChunks = await queryAllChunks<SpecChunkRow>(
    (schema, offset) => ({
      sql: `SELECT content, repo, ingested_at
            FROM ${schema}.chunks
            WHERE file_path = $${offset} AND content_type = 'spec'
                  AND file_path LIKE '%.md'`,
      params: [filePath],
    }),
  );

  if (allChunks.length === 0) {
    return (
      <div>
        <div className="breadcrumb">
          <Link href="/specs">Specifications</Link> / {filePath}
        </div>
        <h1>Not Found</h1>
        <div className="empty-state">
          <p>No spec found at &quot;{filePath}&quot;.</p>
        </div>
      </div>
    );
  }

  // A file_path is normally unique to one repo, but the global view spans
  // every team schema — group by repo so each repo's spec reassembles and
  // scores independently rather than concatenating across repos.
  const byRepo = new Map<string, SpecChunkRow[]>();
  for (const chunk of allChunks) {
    const key = chunk.repo ?? 'unknown';
    const group = byRepo.get(key) ?? byRepo.set(key, []).get(key)!;
    group.push(chunk);
  }

  const specs = [...byRepo.entries()].map(([repo, chunks]) => {
    const content = reassembleSpec(chunks);
    const { statements, counts } = deriveCoverageFromMarkdown(content);
    return { repo, content, title: parseSpecTitle(content, filePath), statements, counts };
  });

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/specs">Specifications</Link> / <strong>{specs[0].title}</strong>
      </div>
      <h1>{specs[0].title}</h1>
      <p className={`meta ${styles.path}`}>{filePath}</p>

      {specs.map((spec, i) => {
        const repoLink = spec.repo && spec.repo.includes('/')
          ? `/repos/${spec.repo}/specs/${encodeURIComponent(filePath)}`
          : null;
        return (
          <div key={spec.repo} className={styles.specGroup}>
            {(spec.repo || repoLink) && (
              <div className={styles.repoRow}>
                {spec.repo && <span className="meta">repo: {spec.repo}</span>}
                {repoLink && <Link href={repoLink} className="meta">view in repo →</Link>}
              </div>
            )}
            <div className={styles.barWrap}>
              <CoverageBar coverage={spec.counts} size="md" />
            </div>
            <SpecDetails repo={spec.repo} content={spec.content} statements={spec.statements as StatementInfo[]} />
            {i < specs.length - 1 && (
              <hr className={styles.divider} />
            )}
          </div>
        );
      })}
    </div>
  );
}
