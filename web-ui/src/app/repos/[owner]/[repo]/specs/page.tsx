export const dynamic = "force-dynamic";
import { fetchTraceSpecs } from '@/lib/trace-api';
import SpecListView from './SpecListView';

export default async function RepoSpecs({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  // The spec-traceability graph is the source of truth — list the spec
  // documents it holds (projected by the ingest-specs task), not Postgres chunks.
  const specs = (await fetchTraceSpecs(fullName)).sort((a, b) => a.localeCompare(b));

  return (
    <div>
      <p className="meta" style={{ marginBottom: 12 }}>
        Specifications in the traceability graph for <code>{fullName}</code> ({specs.length}).
      </p>
      <SpecListView owner={owner} repo={repo} specs={specs} />
    </div>
  );
}
