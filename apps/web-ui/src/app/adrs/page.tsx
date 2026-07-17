export const dynamic = "force-dynamic";
import { fetchAllAdrs } from "@/lib/trace-api";
import { fetchDocStatusesFromGraph } from "@/lib/spec-status-source";
import GlobalDocsView from "@/components/GlobalDocsView";

export default async function AdrsPage() {
  // The spec-traceability graph is the source of truth — the list and the
  // lifecycle status pills (parsed from each ADR's frontmatter) alike.
  const adrs = await fetchAllAdrs();
  const statuses = await fetchDocStatusesFromGraph(adrs, "adr");

  return (
    <div>
      <h1>ADRs</h1>
      <p className="meta" style={{ marginBottom: 16 }}>
        Architecture decision records in the traceability graph across all repos
        ({adrs.length}).
      </p>
      <GlobalDocsView
        docs={adrs}
        statuses={statuses}
        hrefFor={(repo, filePath) =>
          `/repos/${repo}/adrs/${encodeURIComponent(filePath)}`
        }
        emptyHint="No ADRs in the graph yet. ADRs are projected automatically by CI on push to main."
        noMatchHint="No ADRs match this filter."
        chipsKind="adr"
      />
    </div>
  );
}
