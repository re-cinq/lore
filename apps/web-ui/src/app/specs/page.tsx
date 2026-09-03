export const dynamic = "force-dynamic";
import { fetchAllSpecs } from "@/lib/trace-api";
import { statusesByKey } from "@/lib/doc-statuses";
import GlobalDocsView from "@/components/GlobalDocsView";

export default async function SpecsPage() {
  // Spec-traceability graph: single source of truth for list and status pills
  const specs = await fetchAllSpecs();

  return (
    <div>
      <h1>Specs</h1>
      <p className="meta page-lede">
        Spec documents in the traceability graph across all repos (
        {specs.length}).
      </p>
      <GlobalDocsView
        docs={specs}
        statuses={statusesByKey(specs)}
        emptyHint="No specs in the graph yet. Specs are projected automatically by CI on push to main."
        noMatchHint="No specs match this filter."
      />
    </div>
  );
}
