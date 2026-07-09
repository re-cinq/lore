export const dynamic = "force-dynamic";
import { fetchSpecSummaries } from '@/lib/trace-api';
import SpecListView from './SpecListView';

export default async function RepoSpecs({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  // The spec-traceability graph is the source of truth — list each spec as a
  // card summary (title/description/coverage), not Postgres chunks.
  const specs = (await fetchSpecSummaries(fullName)).sort((a, b) => a.filePath.localeCompare(b.filePath));

  return (
    <div>
      <p className="meta" style={{ marginBottom: 12 }}>
        Specs in the traceability graph for <code>{fullName}</code> ({specs.length}).
      </p>
      <SpecListView owner={owner} repo={repo} specs={specs} />
    </div>
  );
}
