export const dynamic = "force-dynamic";

import { fetchProjectionCommits, fetchTraceGraph } from "@/lib/trace-api";
import GraphView from "./GraphView";
import GraphEmptyState from "./GraphEmptyState";
import { decideGraphEmptyReason } from "@/lib/graph-empty-state";

const PAGE_COLUMN: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  height: "calc(100vh - 160px)",
};

interface RepoGraphPageProps {
  params: Promise<{ owner: string; repo: string }>;
}

export default async function RepoGraphPage({ params }: RepoGraphPageProps) {
  const { owner, repo } = await params;
  const [graph, projection] = await Promise.all([
    fetchTraceGraph(`${owner}/${repo}`),
    fetchProjectionCommits(`${owner}/${repo}`),
  ]);

  return (
    <div style={PAGE_COLUMN}>
      <GraphIntro nodes={graph.nodes.length} edges={graph.links.length} />
      {graph.nodes.length === 0 ? (
        <GraphEmptyState reason={decideGraphEmptyReason(projection)} />
      ) : (
        <GraphView owner={owner} repo={repo} graph={graph} />
      )}
    </div>
  );
}

/** What the graph is and how much of it there is. The counts are stated up front because an under-projected graph looks the same as a small repo until you know the numbers. */
function GraphIntro({ nodes, edges }: { nodes: number; edges: number }) {
  return (
    <p className="meta" style={{ marginBottom: 12 }}>
      The spec-traceability graph — specs and the statements that link to a test
      or code, projected by CI (specs/ADRs via <code>lore-ingest.yml</code>,
      tests via <code>lore-tests.yml</code>). Showing {nodes} nodes / {edges}{" "}
      edges.
    </p>
  );
}
