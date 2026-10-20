export const dynamic = "force-dynamic";
import { fetchAllAdrs } from "@/lib/trace-api";
import { statusesByKey } from "@/lib/doc-statuses";
import GlobalDocsView from "@/components/GlobalDocsView";
import DocsScreenHeader from "../specs/DocsScreenHeader";

export default async function AdrsPage() {
  // The spec-traceability graph is the source of truth for both the list and the frontmatter status pills.
  const adrs = await fetchAllAdrs();

  return (
    <div>
      <DocsScreenHeader
        active="adrs"
        summary={`Projected into the trace graph by CI on every push to main. ${adrs.length} architecture decision records across all repos.`}
      />
      <GlobalDocsView
        docs={adrs}
        statuses={statusesByKey(adrs)}
        emptyHint="No ADRs in the graph yet. ADRs are projected automatically by CI on push to main."
        noMatchHint="No ADRs match this filter."
        kind="adr"
      />
    </div>
  );
}
