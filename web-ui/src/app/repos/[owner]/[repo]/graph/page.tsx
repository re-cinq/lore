export const dynamic = 'force-dynamic';

import { fetchTraceGraph } from '@/lib/trace-api';
import GraphView from './GraphView';
import IngestButtons from './IngestButtons';

export default async function RepoGraphPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const graph = await fetchTraceGraph(`${owner}/${repo}`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: 'calc(100vh - 160px)' }}>
      <p className="meta" style={{ marginBottom: 12 }}>
        The spec-traceability graph — specs and the statements that link to a test or code, projected by the{' '}
        <code>ingest-*</code> tasks. Showing {graph.nodes.length} nodes / {graph.links.length} edges.
      </p>
      {graph.nodes.length === 0 ? (
        <>
          <IngestButtons owner={owner} repo={repo} />
          <p style={{ color: 'var(--text-muted)' }}>
            No graph yet. Click <strong>Build graph</strong>, run the tasks (locally via{' '}
            <code>run_task_locally</code> or on the agent runner), then refresh. Requires{' '}
            <code>LORE_DGRAPH_HTTP</code> to be configured on the UI server.
          </p>
        </>
      ) : (
        <GraphView owner={owner} repo={repo} data={graph} />
      )}
    </div>
  );
}
