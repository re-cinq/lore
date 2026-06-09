export const dynamic = "force-dynamic";
import Link from 'next/link';
import { fetchTraceSource } from '@/lib/trace-api';
import Markdown from '@/components/Markdown';

export default async function RepoAdrDetail({
  params,
}: {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
}) {
  const { owner, repo, path } = await params;
  const fullName = `${owner}/${repo}`;
  const filePath = path.map(decodeURIComponent).join('/');
  const adrsLink = `/repos/${owner}/${repo}/adrs`;

  // ADRs have no Statement/coverage overlay — render the byte-exact source
  // reassembled from the graph's Block layer (recomputeFile).
  const source = await fetchTraceSource(fullName, filePath);

  return (
    <div>
      <p className="meta" style={{ marginBottom: 12 }}>
        <Link href={adrsLink}>← ADRs</Link>
      </p>
      {source ? (
        <Markdown markdown={source} />
      ) : (
        <p style={{ color: 'var(--text-muted)' }}>
          No graph data for <code>{filePath}</code>. Build the graph and run the <code>ingest-adrs</code> task, then refresh.
        </p>
      )}
    </div>
  );
}
