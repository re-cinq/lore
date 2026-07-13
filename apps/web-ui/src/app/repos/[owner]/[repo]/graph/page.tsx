export const dynamic = "force-dynamic";

import { fetchTraceGraph } from "@/lib/trace-api";
import GraphView from "./GraphView";

export default async function RepoGraphPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const graph = await fetchTraceGraph(`${owner}/${repo}`);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        height: "calc(100vh - 160px)",
      }}
    >
      <p className="meta" style={{ marginBottom: 12 }}>
        The spec-traceability graph — specs and the statements that link to a
        test or code, projected by CI (specs/ADRs via{" "}
        <code>lore-ingest.yml</code>, tests via <code>lore-tests.yml</code>).
        Showing {graph.nodes.length} nodes / {graph.links.length} edges.
      </p>
      {graph.nodes.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>
          No graph yet. It is built by CI on push to <code>main</code> —
          specs/ADRs via <code>lore-ingest.yml</code> and tests via{" "}
          <code>lore-tests.yml</code> (POSTing <code>/test-report</code> +{" "}
          <code>/coverage</code>); refresh once those run. Requires{" "}
          <code>LORE_DGRAPH_HTTP</code> to be configured on the UI server.
        </p>
      ) : (
        <GraphView owner={owner} repo={repo} data={graph} />
      )}
    </div>
  );
}
