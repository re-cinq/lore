export const dynamic = "force-dynamic";
import { queryAllChunks } from '@/lib/db';
import SpecsListView, { type SpecListItem, type RepoCount } from './SpecsListView';

export default async function SpecsPage({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const { repo } = await searchParams;

  // Get available repos for filter buttons (only repos that have spec-type content)
  const allRepoCounts = await queryAllChunks<RepoCount>(
    (schema) => ({
      sql: `SELECT repo, count(DISTINCT file_path)::int as count
            FROM ${schema}.chunks
            WHERE content_type = 'spec' AND repo IS NOT NULL
                  AND file_path LIKE '%.md'
            GROUP BY repo`,
      params: [],
    }),
  );
  // Merge counts across schemas
  const repoMap = new Map<string, number>();
  for (const row of allRepoCounts) {
    if (row.repo) {
      repoMap.set(row.repo, (repoMap.get(row.repo) || 0) + row.count);
    }
  }
  const repos = [...repoMap.entries()]
    .map(([r, count]) => ({ repo: r, count }))
    .sort((a, b) => b.count - a.count);

  // Fetch specs across all schemas, always filtered to content_type = 'spec'
  const allSpecs = await queryAllChunks<SpecListItem>(
    (schema, offset) => {
      if (repo && repo.trim()) {
        return {
          sql: `SELECT file_path, repo, ingested_at,
                       substring(content, 1, 200) as excerpt
                FROM ${schema}.chunks
                WHERE content_type = 'spec' AND repo = $${offset}
                      AND file_path LIKE '%.md'`,
          params: [repo.trim()],
        };
      }
      return {
        sql: `SELECT file_path, repo, ingested_at,
                     substring(content, 1, 200) as excerpt
              FROM ${schema}.chunks
              WHERE content_type = 'spec' AND file_path LIKE '%.md'`,
        params: [],
      };
    },
  );
  // A spec.md is stored as multiple chunk rows; collapse to one entry per
  // (repo, file_path), keeping the most-recently-ingested chunk. Without this
  // the list shows duplicate cards and silently drops specs past a row cap.
  const latestByPath = new Map<string, SpecListItem>();
  for (const s of allSpecs) {
    const key = `${s.repo ?? ''}::${s.file_path}`;
    const prev = latestByPath.get(key);
    if (!prev || new Date(s.ingested_at).getTime() > new Date(prev.ingested_at).getTime()) {
      latestByPath.set(key, s);
    }
  }
  const specs = [...latestByPath.values()].sort(
    (a, b) => new Date(b.ingested_at).getTime() - new Date(a.ingested_at).getTime(),
  );

  return <SpecsListView activeRepo={repo} repos={repos} specs={specs} />;
}
