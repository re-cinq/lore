export const dynamic = "force-dynamic";
import { fetchSpecSummaries } from "@/lib/trace-api";
import { statusesByPath } from "@/lib/doc-statuses";
import SpecListView from "./SpecListView";

export default async function RepoSpecs({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  // Spec-traceability graph is source of truth for list and lifecycle status pills.
  const summaries = await fetchSpecSummaries(fullName);
  const specs = summaries.sort((a, b) => a.filePath.localeCompare(b.filePath));
  const statuses = statusesByPath(specs);

  return (
    <div>
      <p className="meta page-lede">
        Specs in the traceability graph for <code>{fullName}</code> (
        {specs.length}).
      </p>
      <SpecListView
        owner={owner}
        repo={repo}
        specs={specs}
        statuses={statuses}
      />
    </div>
  );
}
