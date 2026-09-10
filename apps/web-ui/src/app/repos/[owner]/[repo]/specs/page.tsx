export const dynamic = "force-dynamic";
import { fetchSpecSummaries } from "@/lib/trace-api";
import { statusesByPath } from "@/lib/doc-statuses";
import SpecListView from "./SpecListView";

interface RepoSpecsProps {
  params: Promise<{ owner: string; repo: string }>;
}

export default async function RepoSpecs({ params }: RepoSpecsProps) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  // Spec-traceability graph is source of truth for list and lifecycle status pills.
  const summaries = await fetchSpecSummaries(fullName);
  const specs = summaries.sort((a, b) => a.filePath.localeCompare(b.filePath));
  const statuses = statusesByPath(specs);

  return (
    <div>
      <SpecsLede fullName={fullName} count={specs.length} />
      <SpecListView
        owner={owner}
        repo={repo}
        specs={specs}
        statuses={statuses}
      />
    </div>
  );
}

/** What the list is drawn from — the graph, not the repo — and how much of it there is. */
function SpecsLede({ fullName, count }: { fullName: string; count: number }) {
  return (
    <p className="meta page-lede">
      Specs in the traceability graph for <code>{fullName}</code> ({count}).
    </p>
  );
}
