export const dynamic = "force-dynamic";

import {
  fetchProjectionCommits,
  fetchTraceGraph,
  fetchTraceSpecs,
} from "@/lib/trace-api";
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
  searchParams?: Promise<{ path?: string }>;
}

export default async function RepoGraphPage({
  params,
  searchParams,
}: RepoGraphPageProps) {
  const [{ owner, repo }, query] = await Promise.all([params, searchParams]);
  const [graph, projection] = await Promise.all([
    loadRepoGraph(`${owner}/${repo}`, query?.path),
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

/** Fetches the bounded graph for the requested spec, falling back to the repository's first spec. */
async function loadRepoGraph(fullName: string, requestedPath?: string) {
  const specs = await fetchTraceSpecs(fullName);
  const activePath = selectedSpecPath(specs, requestedPath);

  return activePath
    ? fetchTraceGraph(fullName, activePath)
    : { nodes: [], links: [] };
}

/** The spec the query asked for when it exists in the repository, or the repository's first spec. */
function selectedSpecPath(
  specs: readonly string[],
  requested: string | undefined,
): string | undefined {
  if (requested && specs.includes(requested)) {
    return requested;
  }

  return specs[0];
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
