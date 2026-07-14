export const dynamic = "force-dynamic";
import { fetchAllSpecs } from "@/lib/trace-api";
import { fetchSpecStatusesFromGraph } from "@/lib/spec-status-source";
import GlobalSpecsView from "./GlobalSpecsView";

export default async function SpecsPage() {
  // The spec-traceability graph is the source of truth — the list and the
  // lifecycle status pills (parsed from each spec.md's graph source) alike.
  const specs = await fetchAllSpecs();
  const statuses = await fetchSpecStatusesFromGraph(specs);

  return (
    <div>
      <h1>Specs</h1>
      <p className="meta" style={{ marginBottom: 16 }}>
        Spec documents in the traceability graph across all repos (
        {specs.length}).
      </p>
      <GlobalSpecsView specs={specs} statuses={statuses} />
    </div>
  );
}
