export const dynamic = "force-dynamic";
import { fetchAllSpecs } from "@/lib/trace-api";
import { fetchDocStatusesFromGraph } from "@/lib/spec-status-source";
import GlobalDocsView from "@/components/GlobalDocsView";

export default async function SpecsPage() {
  // The spec-traceability graph is the source of truth — the list and the
  // lifecycle status pills (parsed from each spec.md's graph source) alike.
  const specs = await fetchAllSpecs();
  const statuses = await fetchDocStatusesFromGraph(specs, "spec");

  return (
    <div>
      <h1>Specs</h1>
      <p className="meta" style={{ marginBottom: 16 }}>
        Spec documents in the traceability graph across all repos (
        {specs.length}).
      </p>
      <GlobalDocsView
        docs={specs}
        statuses={statuses}
        emptyHint="No specs in the graph yet. Specs are projected automatically by CI on push to main."
        noMatchHint="No specs match this filter."
      />
    </div>
  );
}
