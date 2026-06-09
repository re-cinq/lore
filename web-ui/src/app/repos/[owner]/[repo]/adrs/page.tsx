export const dynamic = "force-dynamic";
import { fetchTraceAdrs } from '@/lib/trace-api';
import AdrListView from './AdrListView';

export default async function RepoAdrs({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;

  // The spec-traceability graph is the source of truth — list the ADR documents
  // it holds (projected by the ingest-adrs task), not Postgres chunks.
  const adrs = (await fetchTraceAdrs(`${owner}/${repo}`)).sort((a, b) => a.localeCompare(b));

  return (
    <div>
      <p className="meta" style={{ marginBottom: 12 }}>
        Architecture decision records in the traceability graph ({adrs.length}).
      </p>
      <AdrListView owner={owner} repo={repo} adrs={adrs} />
    </div>
  );
}
