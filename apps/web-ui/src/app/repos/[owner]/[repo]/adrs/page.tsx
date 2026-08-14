export const dynamic = "force-dynamic";
import { fetchAdrSummaries } from "@/lib/trace-api";
import { statusesByPath } from "@/lib/doc-statuses";
import AdrListView from "./AdrListView";

export default async function RepoAdrs({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  // The spec-traceability graph is the source of truth — list each ADR as a card
  // summary (title/description parsed from its byte-exact source), not Postgres.
  // Lifecycle statuses ride along on the same summaries call.
  const adrs = (await fetchAdrSummaries(fullName)).sort((a, b) =>
    a.filePath.localeCompare(b.filePath),
  );
  const statuses = statusesByPath(adrs);

  return (
    <div>
      <p className="meta page-lede">
        Architecture decision records in the traceability graph ({adrs.length}).
      </p>
      <AdrListView owner={owner} repo={repo} adrs={adrs} statuses={statuses} />
    </div>
  );
}
