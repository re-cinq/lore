export const dynamic = "force-dynamic";
import { fetchAllSpecs } from "@/lib/trace-api";
import { statusesByKey } from "@/lib/doc-statuses";
import GlobalDocsView from "@/components/GlobalDocsView";
import DocsScreenHeader from "./DocsScreenHeader";

export default async function SpecsPage() {
  // Spec-traceability graph: single source of truth for list and status pills
  const specs = await fetchAllSpecs();

  return (
    <div>
      <DocsScreenHeader
        active="specs"
        summary={`Projected into the trace graph by CI on every push to main. ${specs.length} spec documents across all repos.`}
      />
      <GlobalDocsView
        docs={specs}
        statuses={statusesByKey(specs)}
        emptyHint="No specs in the graph yet. Specs are projected automatically by CI on push to main."
        noMatchHint="No specs match this filter."
      />
    </div>
  );
}
