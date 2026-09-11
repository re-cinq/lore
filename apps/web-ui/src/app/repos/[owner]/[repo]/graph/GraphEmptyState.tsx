import type { GraphEmptyReason } from "@/lib/graph-empty-state";

const MUTED: React.CSSProperties = { color: "var(--text-muted)" };

/** Says why the graph is empty and what fills it, from what CI actually projected: before this the page blamed CI even for a repo whose tests had landed and which simply had no specs. */
export default function GraphEmptyState({
  reason,
}: {
  reason: GraphEmptyReason;
}) {
  if (reason.kind === "tests-only") {
    return <TestsOnlyNote commit={reason.commit} />;
  }

  if (reason.kind === "docs-unlinked") {
    return <DocsUnlinkedNote commit={reason.commit} />;
  }

  return <NeverProjectedNote />;
}

function TestsOnlyNote({ commit }: { commit: string }) {
  return (
    <p style={MUTED}>
      Tests were projected at {shortSha(commit)} by <code>lore-tests.yml</code>,
      but this repo has no specs or ADRs to link them to. The graph is rooted in
      specs: add a <code>specs/</code> document whose statements carry{" "}
      <code>validated by</code> links and push to <code>main</code>.
    </p>
  );
}

function DocsUnlinkedNote({ commit }: { commit: string }) {
  return (
    <p style={MUTED}>
      Specs/ADRs were projected at {shortSha(commit)}, but no statement links to
      a test, code or ADR yet. Add <code>validated by</code> links to the
      statements and push to <code>main</code>.
    </p>
  );
}

function NeverProjectedNote() {
  return (
    <p style={MUTED}>
      No graph yet. It is built by CI on push to <code>main</code> — specs/ADRs
      via <code>lore-ingest.yml</code> and tests via <code>lore-tests.yml</code>
      ; refresh once those run. Requires <code>LORE_DGRAPH_HTTP</code> to be
      configured on the UI server.
    </p>
  );
}

function shortSha(commit: string): string {
  return commit.slice(0, 7);
}
