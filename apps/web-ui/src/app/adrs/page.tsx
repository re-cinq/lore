export const dynamic = "force-dynamic";
import { fetchAllAdrs } from "@/lib/trace-api";
import { statusesByKey } from "@/lib/doc-statuses";
import GlobalDocsView from "@/components/GlobalDocsView";

export default async function AdrsPage() {
  // The spec-traceability graph is the source of truth — the list and the
  // lifecycle status pills (from each ADR's frontmatter) alike, both from
  // this one call.
  const adrs = await fetchAllAdrs();

  return (
    <div>
      <h1>ADRs</h1>
      <p className="meta page-lede">
        Architecture decision records in the traceability graph across all repos
        ({adrs.length}).
      </p>
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
